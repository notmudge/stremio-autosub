const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7000;

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/configure.html');
});

function parseConfig(configStr) {
    const decoded = decodeURIComponent(configStr);
    const parts = decoded.split('|');
    let sources = parts.slice(2).map(u => decodeURIComponent(u));
    
    // Default to OpenSubtitles if missing
    if (sources.length === 0) sources = ["https://opensubtitles-v3.strem.io"];

    return {
        realLang: parts[0] || 'eng',
        spoofLang: parts[1] || 'mri',
        sources: sources
    };
}

// 1. Manifest
app.get(/^\/(.+)\/manifest.json$/, (req, res) => {
    const configStr = req.params[0];
    const { realLang } = parseConfig(configStr);

    res.json({
        id: `org.community.autosub.native.${realLang}`,
        version: '5.0.0',
        name: `Auto-Sub (Native Rank)`,
        description: `Uses official OpenSubtitles ranking (Hash/Downloads). Best for sync.`,
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

    // 1. Extract Metadata (Still needed for the API call)
    let videoHash = null;
    if (extra) {
        const matchHash = extra.match(/videoHash=([^&.]+)/);
        if (matchHash) videoHash = matchHash[1];
    }

    console.log(`[${id}] Fetching native results... Hash: ${!!videoHash}`);

    try {
        // 2. Fetch from OpenSubtitles (and preserve their order)
        // We only map the first source to preserve strict order logic
        const primarySource = sources[0]; 
        
        let url = `${primarySource}/subtitles/${type}/${id}`;
        if (videoHash) url += `/videoHash=${videoHash}`;
        url += `.json`;

        const response = await axios.get(url, { timeout: 5000 });
        const originalSubs = response.data.subtitles || [];

        // 3. Process Results (NO RE-SORTING)
        // We filter by language but KEEP the original index.
        let candidates = [];
        
        originalSubs.forEach((sub, index) => {
            if (sub.lang && (sub.lang.startsWith(realLang) || (realLang === 'eng' && sub.lang === 'en'))) {
                candidates.push(sub);
            }
        });

        // 4. Map to Spoof Language (Top 3 Only)
        // Since we didn't sort, 'candidates[0]' is exactly what OpenSubtitles thinks is #1.
        const finalSubs = candidates.slice(0, 3).map((sub, index) => {
            
            // Generate Label: "Maori" -> "Maori 2" -> "Maori 3"
            let langLabel = spoofLang; // "mri"
            
            // Note: We use unique IDs to ensure Stremio sees them as different tracks
            // Rank #1 (Index 0) gets the pure 'spoofLang' to force Auto-Play.
            // Rank #2 & #3 get slight modifications or just ID changes.
            
            // To differentiate visually in the menu if Stremio groups them:
            // We can't easily change the visible text without breaking the language code,
            // but Stremio usually sorts duplicates by ID.
            
            return {
                ...sub,
                id: `autosub_${index}_${sub.id}`, // Unique ID
                lang: spoofLang // All show as Maori so they float to the top
            };
        });

        res.json({ subtitles: finalSubs });

    } catch (e) {
        console.error(`Error for ${id}:`, e.message);
        res.json({ subtitles: [] });
    }
});

app.listen(PORT, () => {
    console.log(`Addon running on port ${PORT}`);
});