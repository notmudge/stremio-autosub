const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7000;

// 1. VIDEO TYPES (For Sync Check)
const TYPES = {
    bluray: ['bluray', 'brrip', 'bdrip'],
    web: ['web-dl', 'webrip', 'web', 'hdrip'],
};

// 2. RELEASE GROUPS (The "Magic" Sync Fixer)
// If the filename matches the subtitle's release group, it's usually perfect.
const GROUPS = [
    'rarbg', 'yify', 'yts', 'galaxyrg', 'sparks', 'geckos', 'amiable', 
    'cinefile', 'drones', 'replies', 'demands', 'meen', 'fleet', 'msd',
    'x264', 'x265', '10bit', '60fps'
];

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
        id: `org.community.autosub.groups.${realLang}`,
        version: '4.6.0',
        name: `Auto-Sub (Smart Group)`,
        description: `Prioritizes Release Groups (YIFY, RARBG) and Hash matches. Top 3 Results.`,
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
                // We keep the ORIGINAL INDEX from OpenSubtitles because that implies "Popularity"
                res.subs.forEach((s, idx) => {
                    allSubs.push({ ...s, _originIndex: idx, _source: "OS" });
                });
            }
        });

        let isBluRay = TYPES.bluray.some(t => videoFilename.includes(t));
        let isWeb = TYPES.web.some(t => videoFilename.includes(t));

        let processedSubs = [];
        const seenUrls = new Set(); 

        allSubs.forEach(sub => {
            if (seenUrls.has(sub.url)) return;
            seenUrls.add(sub.url);

            if (sub.lang && (sub.lang.startsWith(realLang) || (realLang === 'eng' && sub.lang === 'en'))) {
                
                // STARTING SCORE based on Popularity (Original Rank)
                // Rank 0 gets 100pts, Rank 1 gets 99pts... 
                // This ensures if we have NO other clues, we trust OpenSubtitles' order.
                let score = 100 - sub._originIndex; 
                
                const subText = (sub.id + " " + (sub.url || "")).toLowerCase();
                const isAI = subText.includes('machine') || subText.includes('translated');

                // A. RELEASE GROUP MATCH (The "Option 3" Fix)
                // If video is "Avatar...YIFY.mp4" and sub is "Avatar...YIFY.srt", HUGE BOOST.
                GROUPS.forEach(group => {
                    if (videoFilename.includes(group) && subText.includes(group)) {
                        score += 80; // Strong sync indicator
                    }
                });

                // B. STRICT TYPE MATCHING
                if (isBluRay) {
                    if (TYPES.bluray.some(t => subText.includes(t))) score += 50; 
                    else if (TYPES.web.some(t => subText.includes(t))) score -= 50; // Penalty
                } else if (isWeb) {
                    if (TYPES.web.some(t => subText.includes(t))) score += 50; 
                    else if (TYPES.bluray.some(t => subText.includes(t))) score -= 50; 
                }

                // C. Hash Match (Gold Standard)
                if (videoHash && sub._source === 'OS' && sub._originIndex === 0) {
                     // Usually OS returns hash matches at index 0 when querying by hash
                     score += 500;
                }

                // D. FPS Check
                if (videoFilename.includes('23.976') && subText.includes('23.976')) score += 30;

                // E. AI Penalty
                if (isAI) score -= 20;

                processedSubs.push({ ...sub, _score: score });
            }
        });

        // SORT (Highest Score First)
        processedSubs.sort((a, b) => b._score - a._score);

        // RETURN TOP 3
        const finalSubs = processedSubs.slice(0, 3).map((sub, index) => {
            let langLabel = spoofLang;
            if (index > 0) langLabel = `${spoofLang} ${index + 1}`; 

            return {
                ...sub,
                id: `best_${index}_${sub.id}`, 
                lang: spoofLang
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