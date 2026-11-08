# Custom order alert sounds

Put your own alert sounds in this folder (MP3, WAV, OGG or M4A).
Keep each file short (1–3 seconds) and small (under 200 KB).

To make a file selectable in Settings > Order alerts > Alert sound:

1. Copy the file here, for example `Admin/sounds/shop-bell.mp3`.
   Use lowercase letters, numbers and dashes in the file name (no spaces).
2. Open `Admin/OrderAlerts.js` and find `const SOUND_FILES = [`.
3. Add one line inside the brackets for each file:

   ```js
   const SOUND_FILES = [
     {id: "shop-bell", label: "Shop bell", src: "/Admin/sounds/shop-bell.mp3"},
   ];
   ```

   - `id`: a short name with no spaces (different from the others)
   - `label`: what Staff and Admin see in the list
   - `src`: the path to the file, starting with `/Admin/sounds/`
4. Save, refresh the page (Ctrl+F5), then choose it in Settings and press Play.

Only use sounds you are allowed to use (made by you, or free to use).
