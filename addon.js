const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7000; // Updated to use Render's port if available
const RELEASE_TAGS = ['bluray', 'brrip', 'web-dl', 'webrip', 'web', 'hdrip', 'dvdrip', 'cam', 'ts', 'tc'];

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/configure.html');
});

// Helper to decode config string
function parseConfig(configStr) {
    // If the browser encoded slashes as %2F, decode them first
    const decoded = decodeURIComponent(configStr);
    const parts = decoded.split('|');
    return {
        realLang: parts[0] || 'eng',
        spoofLang: parts[1] || 'mri',
        sources: parts.slice(2).map(u => decodeURIComponent(u))
    };
}

// ---------------------------------------------------------
// ROUTE 1: MANIFEST (Regex Fix)
// Matches anything that ends in /manifest.json
// ---------------------------------------------------------
app.get(/^\/(.+)\/manifest.json$/, (req, res) => {
    const configStr = req.params[0]; // Captures everything before /manifest.json
    const { realLang, spoofLang, sources } = parseConfig(configStr);

    res.json({
        id: `org.community.singlebest.ai.${realLang}`,
        version: '4.2.0',
        name: `Auto-Sub (Robust)`,
        description: `Auto-plays Human match. Falls back to AI. (Fixed for Render)`,
        resources: ['subtitles'],
        types: ['movie', 'series'],
        catalogs: [],
        idPrefixes: ['tt']
    });
});

// ---------------------------------------------------------
// ROUTE 2: SUBTITLES (Regex Fix)
// Matches /config/subtitles/type/id/extra.json
// ---------------------------------------------------------
app.get(/^\/(.+)\/subtitles\/([^/]+)\/([^/]+)(?:\/([^/]+))?\.json$/, async (req, res) => {
    const configStr = req.params[0];
    const type = req.params[1];
    const id = req.params[2];
    const extra = req.params[3]; // This might be undefined

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

    console.log(`[${id}] Fetching... (Hash: ${!!videoHash}) Sources: ${sources.length}`);

    try {
        // 2. Parallel Fetch
        const fetchPromises = sources.map(async (baseUrl) => {
            if (!baseUrl.startsWith('http')) return { source: baseUrl, subs: [] }; // Safety check
            try {
                let url = `${baseUrl}/subtitles/${type}/${id}`;
                if (videoHash) url += `/videoHash=${videoHash}`;
                url += `.json`;
                const response = await axios.get(url, { timeout: 5000 });
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

        // 3. Filter & Score
        let processedSubs = [];
        const seenUrls = new Set(); 

        allSubs.forEach(sub => {
            if (seenUrls.has(sub.url)) return;
            seenUrls.add(sub.url);

            if (sub.lang && (sub.lang.startsWith(realLang) || (realLang === 'eng' && sub.lang === 'en'))) {
                let score = 0;
                const subText = (sub.id + " " + (sub.url || "")).toLowerCase();
                const isAI = subText.includes('machine') || subText.includes('translated');

                // A. Release Tag Matching
                RELEASE_TAGS.forEach(tag => {
                    if (videoFilename.includes(tag) && subText.includes(tag)) score += 20;
                    else if (!videoFilename.includes(tag) && subText.includes(tag)) score -= 5;
                });

                // B. Hash Match (Best)
                if (videoHash && sub._origin === 'OS') score += 50;

                // C. AI Logic
                if (isAI) score -= 10;

                processedSubs.push({ ...sub, _score: score, _isAI: isAI });
            }
        });

        // 4. Sort
        processedSubs.sort((a, b) => b._score - a._score);

        // 5. RETURN ONLY THE WINNER
        const finalSubs = [];
        if (processedSubs.length > 0) {
            const winner = processedSubs[0];
            finalSubs.push({
                ...winner,
                id: `best_${winner.id}`, 
                lang: spoofLang // Auto-Play
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