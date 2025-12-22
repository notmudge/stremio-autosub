const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

const PORT = 7000;
// Keywords for scoring (BluRay vs WebDL etc)
const RELEASE_TAGS = ['bluray', 'brrip', 'web-dl', 'webrip', 'web', 'hdrip', 'dvdrip', 'cam', 'ts', 'tc'];

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/configure.html');
});

function parseConfig(configStr) {
    const parts = configStr.split('|');
    return {
        realLang: parts[0] || 'eng',
        spoofLang: parts[1] || 'mri',
        sources: parts.slice(2).map(u => decodeURIComponent(u))
    };
}

app.get('/:config/manifest.json', (req, res) => {
    const { realLang, spoofLang, sources } = parseConfig(req.params.config);

    res.json({
        id: `org.community.singlebest.${realLang}`,
        version: '4.0.0',
        name: `Auto-Sub (Best Only)`,
        description: `Returns ONLY the single best matching subtitle. No backup options.`,
        resources: ['subtitles'],
        types: ['movie', 'series'],
        catalogs: [],
        idPrefixes: ['tt']
    });
});

app.get(['/:config/subtitles/:type/:id/:extra.json', '/:config/subtitles/:type/:id.json'], async (req, res) => {
    const { config, type, id, extra } = req.params;
    const { realLang, spoofLang, sources } = parseConfig(config);

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

    console.log(`[${id}] Fetching best match... (Hash: ${!!videoHash})`);

    try {
        // 2. Parallel Fetch from all sources
        const fetchPromises = sources.map(async (baseUrl) => {
            try {
                let url = `${baseUrl}/subtitles/${type}/${id}`;
                if (videoHash) url += `/videoHash=${videoHash}`;
                url += `.json`;
                // Short timeout to keep it snappy
                const response = await axios.get(url, { timeout: 5000 });
                return { source: baseUrl, subs: response.data.subtitles || [] };
            } catch (e) { return { source: baseUrl, subs: [] }; }
        });

        const results = await Promise.all(fetchPromises);
        
        // 3. Merge Results
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

        // 4. Filter & Score
        let processedSubs = [];
        const seenUrls = new Set(); 

        allSubs.forEach(sub => {
            if (seenUrls.has(sub.url)) return;
            seenUrls.add(sub.url);

            // Filter for target language
            if (sub.lang && (sub.lang.startsWith(realLang) || (realLang === 'eng' && sub.lang === 'en'))) {
                let score = 0;
                const subText = (sub.id + " " + (sub.url || "")).toLowerCase();

                // A. Release Tag Matching (Critical for Sync)
                RELEASE_TAGS.forEach(tag => {
                    if (videoFilename.includes(tag) && subText.includes(tag)) score += 20;
                    else if (!videoFilename.includes(tag) && subText.includes(tag)) score -= 10;
                });

                // B. Penalties for "Bad" Subs
                if (subText.includes('machine') || subText.includes('translated')) score -= 50;
                if (subText.includes('sdh') || subText.includes('impaired')) score -= 2; // Slight penalty for SDH
                
                // C. Boost Verified Hash Matches (OpenSubtitles)
                if (videoHash && sub._origin === 'OS') score += 15;

                processedSubs.push({ ...sub, _score: score });
            }
        });

        // 5. Sort (Highest Score First)
        processedSubs.sort((a, b) => b._score - a._score);

        // 6. RETURN ONLY THE WINNER
        const finalSubs = [];
        
        if (processedSubs.length > 0) {
            const winner = processedSubs[0];
            
            console.log(`[${id}] Winner: ${winner.id} (Score: ${winner._score})`);
            
            finalSubs.push({
                ...winner,
                id: `best_${winner.id}`, // Unique ID
                lang: spoofLang          // "mri" -> Auto-Play
            });
        }

        res.json({ subtitles: finalSubs });

    } catch (e) {
        console.error(e);
        res.json({ subtitles: [] });
    }
});

app.listen(PORT, () => {
    console.log(`Addon running at http://localhost:${PORT}`);
});