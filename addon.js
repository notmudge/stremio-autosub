const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7000;

// STRICT MATCHING TAGS
const TYPES = {
    bluray: ['bluray', 'brrip', 'bdrip'],
    web: ['web-dl', 'webrip', 'web', 'hdrip'],
};

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/configure.html');
});

function parseConfig(configStr) {
    const decoded = decodeURIComponent(configStr);
    const parts = decoded.split('|');
    let sources = parts.slice(2).map(u => decodeURIComponent(u));
    if (sources.length === 0) sources = ["https://opensubtitles-v3.strem.io"];

    return {
        realLang: parts[0] || 'eng',
        spoofLang: parts[1] || 'mri',
        sources: sources
    };
}

app.get(/^\/(.+)\/manifest.json$/, (req, res) => {
    const configStr = req.params[0];
    const { realLang } = parseConfig(configStr);

    res.json({
        id: `org.community.autosub.top3.${realLang}`,
        version: '4.5.0',
        name: `Auto-Sub (Top 3)`,
        description: `Auto-plays the best match. Shows 2 backups. Strict Sync.`,
        resources: ['subtitles'],
        types: ['movie', 'series'],
        catalogs: [],
        idPrefixes: ['tt']
    });
});

app.get(/^\/(.+)\/subtitles\/([^/]+)\/([^/]+)(?:\/([^/]+))?\.json$/, async (req, res) => {
    const configStr = req.params[0];
    const type = req.params[1];
    const id = req.params[2];
    const extra = req.params[3];

    const { realLang, spoofLang, sources } = parseConfig(configStr);

    // 1. Extract Metadata
    let videoHash = null;
    let videoFilename = "";
    if (extra) {
        const matchHash = extra.match(/videoHash=([^&.]+)/);
        if (matchHash) videoHash = matchHash[1];
        const matchFile = extra.match(/filename=([^&]+)/);
        if (matchFile) {
            try { videoFilename = decodeURIComponent(matchFile[1]).toLowerCase(); } 
            catch (e) { videoFilename = matchFile[1].toLowerCase(); }
        }
    }

    console.log(`[${id}] File: ${videoFilename || "Unknown"} | Hash: ${!!videoHash}`);

    try {
        // 2. Parallel Fetch
        const fetchPromises = sources.map(async (baseUrl) => {
            if (!baseUrl.startsWith('http')) return { source: baseUrl, subs: [] };
            try {
                let url = `${baseUrl}/subtitles/${type}/${id}`;
                if (videoHash) url += `/videoHash=${videoHash}`;
                url += `.json`;
                const response = await axios.get(url, { timeout: 4500 });
                return { source: baseUrl, subs: response.data.subtitles || [] };
            } catch (e) { return { source: baseUrl, subs: [] }; }
        });

        const results = await Promise.all(fetchPromises);
        
        let allSubs = [];
        results.forEach(res => {
            if (res.subs.length > 0) {
                res.subs.forEach(s => {
                    allSubs.push({ ...s, _origin: "OS" });
                });
            }
        });

        // 3. IDENTIFY VIDEO TYPE
        let isBluRay = TYPES.bluray.some(t => videoFilename.includes(t));
        let isWeb = TYPES.web.some(t => videoFilename.includes(t));

        // 4. FILTER & SCORE
        let processedSubs = [];
        const seenUrls = new Set(); 

        allSubs.forEach(sub => {
            if (seenUrls.has(sub.url)) return;
            seenUrls.add(sub.url);

            if (sub.lang && (sub.lang.startsWith(realLang) || (realLang === 'eng' && sub.lang === 'en'))) {
                let score = 0;
                const subText = (sub.id + " " + (sub.url || "")).toLowerCase();
                const isAI = subText.includes('machine') || subText.includes('translated');

                // A. STRICT TYPE MATCHING
                if (isBluRay) {
                    if (TYPES.bluray.some(t => subText.includes(t))) score += 50; 
                    else if (TYPES.web.some(t => subText.includes(t))) score -= 100;
                } else if (isWeb) {
                    if (TYPES.web.some(t => subText.includes(t))) score += 50; 
                    else if (TYPES.bluray.some(t => subText.includes(t))) score -= 100; 
                }

                // B. Hash Match (Priority)
                if (videoHash) score += 200;

                // C. FPS Check
                if (videoFilename.includes('23.976') && subText.includes('23.976')) score += 20;

                // D. AI Logic
                if (isAI) score -= 10;

                processedSubs.push({ ...sub, _score: score });
            }
        });

        // 5. Sort (Highest Score First)
        processedSubs.sort((a, b) => b._score - a._score);

        // 6. RETURN TOP 3 SURVIVORS
        const finalSubs = processedSubs.slice(0, 3).map((sub, index) => {
            // Index 0 = "mri" (Auto Play)
            // Index 1 = "mri 2" (Backup)
            // Index 2 = "mri 3" (Backup)
            
            let langLabel = spoofLang;
            if (index > 0) {
                // We add a number so user can distinguish them in the list
                // Note: Stremio might group them if lang code is identical, so we try to differentiate ID
                langLabel = `${spoofLang} ${index + 1}`; 
            }

            return {
                ...sub,
                id: `best_${index}_${sub.id}`, 
                lang: spoofLang, // Keep code same for grouping, or vary it if you want distinct rows
                // We will rely on Stremio order. Best score is first.
            };
        });

        res.json({ subtitles: finalSubs });

    } catch (e) {
        console.error(e);
        res.json({ subtitles: [] });
    }
});

app.listen(PORT, () => {
    console.log(`Addon running on port ${PORT}`);
});