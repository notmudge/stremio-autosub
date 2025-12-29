# Auto-Sub for Stremio (Strict Sync)

A smart Stremio addon that forces the **single best** subtitle to **auto-play** immediately.

It acts as a "VIP Pass" for OpenSubtitles, taking their best results (Hash Matches) and prioritizing them over Stremio's default "Embedded" subtitles.

## 🚀 The Problem
Stremio often defaults to "Embedded" subtitles (which are often ugly or basic) or makes you scroll through 20 "English" options to find one that is synced.

## ✨ The Solution
This addon:
1.  Fetches subtitles from **OpenSubtitles v3**.
2.  **Preserves the Native Ranking:** It trusts OpenSubtitles' official order (which puts Perfect Hash Matches at #1).
3.  **The "Highlander" Trick:** It takes the **Top 3** best results and renames them to a "Spoof Language" (e.g., **Maori**).
4.  **Auto-Play:** Since you set Stremio to prefer "Maori", it instantly plays the #1 result.

## 🧠 How it Works
Unlike other addons that try to guess the best subtitle based on filenames (which can be risky), **Auto-Sub** relies on **Community Validation**:

1.  **🥇 Rank #1 (Auto-Play):**
    * This is usually a **Verified Hash Match**. It matches your video file's unique fingerprint 100%.
    * The addon labels this "Maori" so it plays automatically.
2.  **🥈 Rank #2 & 🥉 Rank #3 (Backups):**
    * If the first one fails, the next two best options (highest download count) are right there in the list, also labeled "Maori".

## 🛠️ Installation

### 1. Configure & Install
Click the link below to configure your languages and install the addon.

[**👉 Install Auto-Sub**](https://stremio-autosub.onrender.com)

### 2. Critical Stremio Setting
For the auto-play to work, you **must** change one setting in Stremio:
1.  Go to **Settings > Player**.
2.  Set **Default Subtitle Language** to **Maori** (or whichever language you chose as the 'Spoof').

## 💻 Tech Stack
* **Node.js & Express:** Lightweight backend.
* **Stremio Protocol:** Standard addon implementation.
* **Native Ranking:** Passthrough logic to ensure sync accuracy.

## 📝 Credits
* Powered by **OpenSubtitles v3**.
* Developed by [notmudge](https://github.com/notmudge).
