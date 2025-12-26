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
    cam: ['cam', 'ts', 'tc', 'dvdscr']
};

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/configure.html');
});

function parseConfig(configStr) {
    const decoded = decodeURIComponent(configStr);
    const parts = decoded.split('|');
    return {
        realLang: parts[0] || 'eng',
        spoofLang: parts[1] || 'mri',
        sources: parts.slice(2).map(u => decodeURIComponent(u))
    };
}

// 1. Manifest
app.get(/^\/(.+)\/manifest.json$/, (req, res) => {
    const configStr = req.params[0];
    const { realLang } = parseConfig(configStr);

    res.json({
        id: `org.community.autosub.strict.${realLang}`,
        version: '4.3.0',
        name: `Auto-Sub (Strict Sync)`,
        description: `Strictly matches BluRay to BluRay, Web to Web. Prevents "Too Fast" issues.`,
        resources: ['subtitles'],
        types: ['movie', 'series'],
        catalogs: [],
        idPrefixes: ['tt']
    });
});

// 2. Subtitles
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
                    let sourceName = "UNK";
                    if(res.source.includes("opensub")) sourceName = "OS";
                    if(res.source.includes("subdl")) sourceName = "SDL";
                    allSubs.push({ ...s, _origin: sourceName });
                });
            }
        });

        // 3. IDENTIFY VIDEO TYPE
        let isBluRay = TYPES.bluray.some(t => videoFilename.includes(t));
        let isWeb = TYPES.web.some(t => videoFilename.includes(t));
        let isCam = TYPES.cam.some(t => videoFilename.includes(t));

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
                // If we KNOW the video type, we punish mismatches heavily.
                if (isBluRay) {
                    if (TYPES.bluray.some(t => subText.includes(t))) score += 50; // Perfect match
                    else if (TYPES.web.some(t => subText.includes(t))) score -= 100; // WRONG TYPE (Fast/Slow issue)
                } else if (isWeb) {
                    if (TYPES.web.some(t => subText.includes(t))) score += 50; // Perfect match
                    else if (TYPES.bluray.some(t => subText.includes(t))) score -= 100; // WRONG TYPE
                }

                // B. Hash Match (Always wins)
                if (videoHash && sub._origin === 'OS') score += 200;

                // C. FPS Check (Advanced)
                // If filename has "23.976" and sub has "23.976", boost it.
                if (videoFilename.includes('23.976') && subText.includes('23.976')) score += 20;
                if (videoFilename.includes('24.000') && subText.includes('24.000')) score += 20;

                // D. AI Logic
                if (isAI) score -= 10;

                processedSubs.push({ ...sub, _score: score });
            }
        });

        // 5. Sort (Highest Score First)
        processedSubs.sort((a, b) => b._score - a._score);

        // 6. RETURN WINNER
        const finalSubs = [];
        if (processedSubs.length > 0) {
            const winner = processedSubs[0];

            // SAFETY CHECK: If the winner has a very low score (meaning it's likely a mismatch),
            // we might want to return NOTHING rather than a bad subtitle.
            // But usually, users prefer *something* over *nothing*.
            
            console.log(`[${id}] Winner: ${winner.id} (Score: ${winner._score})`);

            finalSubs.push({
                ...winner,
                id: `best_${winner.id}`, 
                lang: spoofLang 
            });
        }

        res.json({ subtitles: finalSubs });

    } catch (e) {
        console.error(e);
        res.json({ subtitles: [] });
    }
});

app.listen(PORT, () => {
    console.log(`Addon running on port ${PORT}`);
});