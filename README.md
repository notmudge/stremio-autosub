# Auto-Sub for Stremio (Single Best Match)

A smart Stremio addon that finds the **single best** subtitle for your movie and forces it to **auto-play** immediately.

It acts as an aggregator (OpenSubtitles v3 + SubDL) and uses a "Highlander" logic (*There can be only one*) to prevent the user from choosing bad subtitles.

## 🚀 The Problem it Solves
Stremio often defaults to "Embedded" subtitles (which are often basic or ugly) or picks the first English subtitle it finds (which might be for the wrong file version, causing sync issues).

Users often have to:
1. Pause the movie.
2. Click the subtitle menu.
3. Scroll through 20 "English" options.
4. Guess which one works.

## ✨ The Solution
This addon acts as a filter. It fetches all subtitles, scores them, picks the **#1 Winner**, and deletes the rest.

It then uses a **Language Spoofing Trick**:
* It renames the English subtitle to **"Maori"** (or another unused language).
* If you set your Stremio default language to "Maori", Stremio sees this as the **only valid option** and plays it instantly.

## 🧠 The Logic (Ranking System)
The addon retrieves subtitles from multiple sources and ranks them based on a "Confidence Score":

1.  **🥇 Gold (Hash Match):**
    * If the subtitle matches the exact **File Fingerprint (Hash)** of your video, it is guaranteed to be perfectly synced.
    * **Score:** `+50 points`

2.  **🥈 Silver (Filename Match):**
    * The addon compares your video filename (e.g., `Avatar.2009.BluRay.1080p.mkv`) with the subtitle name.
    * It looks for key tags: `BluRay`, `Web-DL`, `HDRip`, `CAM`, etc.
    * **Match:** `+20 points`
    * **Mismatch:** `-5 points` (e.g., Trying to play a Web-DL sub on a BluRay video).

3.  **🥉 Bronze (Generic Human):**
    * Standard human-translated subtitles that don't have specific metadata.
    * **Score:** `0 points`

4.  **🤖 Fallback (AI / Machine):**
    * If no human subtitles exist, it allows AI-translated ones.
    * **Score:** `-10 points` (They only win if the list is empty).

## 🛠️ Installation

### 1. Configure
You can configure the addon to use OpenSubtitles (Default) and optionally add your **SubDL API Key**.

[**Click Here to Configure & Install**](https://stremio-autosub.onrender.com)
*(Replace this link with your actual Render URL)*

### 2. Stremio Setup (Critical!)
For the auto-play to work, you must change one setting in Stremio:
1.  Go to **Settings > Player**.
2.  Set **Default Subtitle Language** to **Maori**.

## 💻 Tech Stack
* **Node.js & Express:** Lightweight backend.
* **Axios:** Parallel fetching from multiple APIs.
* **Stremio Addon SDK:** Standard protocol implementation
