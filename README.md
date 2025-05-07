# JPDB Nadeshiko Examples  

A Tampermonkey userscript for **jpdb.io** that embeds anime examples from **Nadeshiko** directly into the site.  

## Features  

- **Anime example images** displayed alongside vocab.  
- **Audio support** with autoplay and manual controls.  
- **Navigation arrows** to cycle through examples.  
- **Favorites system** to select preferred examples.  
- **Configurable settings** for appearance and behavior.  
- **Blacklist feature** to block unwanted examples.  

## Controls  

| Icon                | Function                                           |
|---------------------|----------------------------------------------------|
| 🔊 **Speaker**      | Play example audio.                                |
| ⭐ **Star**          | Mark as favorite (★ = favorite, ☆ = non-favorite). |
| 「」 **Exact Search** | Toggle exact search (「」 = enabled, 『』 = disabled). |
| ◀ **Left Arrow**    | Go back one example.                               |
| ▶ **Right Arrow**   | Go forward one example.                            |
| ☰ **Menu Button**   | Open the settings menu.                            |

## Config Options  

The settings menu (**☰**) allows customization of the script's behavior:  

- **Image Width** – Adjust image size.  
- **Wide Mode** – Place image next to or above meanings.  
- **Definitions on Right in Wide Mode** – Place image left and definitions right.  
- **Arrow Width/Height** – Resize navigation arrows.  
- **Page Width** – Adjust overall layout width.  
- **Sound Volume** – Control audio playback volume.  
- **Enable Example Translation** – Show/hide English translation.  
- **Sentence Font Size** – Resize Japanese text.  
- **Translation Font Size** – Resize English translation.  
- **Colored Sentence Text** – Highlight vocab in the sentence.  
- **Auto Play Sound** – Automatically play audio when changing examples.  
- **Number of Preloads** – Set how many examples load in the background.  
- **Vocab Size** – Adjust vocab text size in reviews.  
- **Default to Exact Search** – Enables exact search option by default.
- **Hotkeys** – Buttons to go to next/previous example. Can easily add any key by editing line #27
- **Minimum Example Length** – Set a lower limit for sentence length.  
  - **⚠ Warning:** Changing this **will delete all current favorites.**  
- **Blacklist** – Prevent specific examples from appearing.  
- **Randomize sentences** – Randomize the order of examples for a word.
- **Weighted Randomization** – Randomize the order of examples for a word, but with a bias towards sentences with most known words. (Require jpdb API key)
## How It Works  

The script searches **Nadeshiko** for examples based on the current vocabulary and embeds them into **jpdb.io**. Audio can be played manually or automatically.  

### **Audio Playback Note**  
If autoplay doesn't work, check your browser's site settings (click the lock icon next to the URL) and allow automatic audio playback.  

## Favorite System  

Favorites allow you to pick a default example for a word. Next time the word appears, your chosen example will be used.  

## Links  

- 📜 **GitHub Repository:** [https://github.com/Sacus1/JPDB-Nadeshiko-Examples](https://github.com/Sacus1/JPDB-Nadeshiko-Examples)  
- 📥 **Download at Greasyfork:** [https://greasyfork.org/en/scripts/529745-jpdb-nadeshiko-examples](https://greasyfork.org/en/scripts/529745-jpdb-nadeshiko-examples)
- 🛠 **JPDB Website:** [https://jpdb.io](https://jpdb.io)  
- 🎞 **Nadeshiko:** [https://nadeshiko.co](https://nadeshiko.co)

## Similar Projects  
 
- **JPDB Media Support:** [https://github.com/felix-ops/JPDB-Media-Support](https://github.com/felix-ops/JPDB-Media-Support)  
- **Standalone Chrome Variant:** [https://chromewebstore.google.com/detail/jpdb-immersion-kit-exampl/knedmjcggobmokkephmaggbgakjjckbf](https://chromewebstore.google.com/detail/jpdb-immersion-kit-exampl/knedmjcggobmokkephmaggbgakjjckbf) 

## Contributing  

Contributions are welcome! If you encounter bugs, have feature suggestions, or want to improve the script, feel free to open an issue or submit a pull request on **GitHub**.  

## License  

This project is licensed under the **MIT License**.  

