// ==UserScript==
// @name         JPDB Nadeshiko Examples
// @version      2026-05-01
// @description  Embeds anime images & audio examples into JPDB review and vocabulary pages using Nadeshiko's API. Compatible only with TamperMonkey.
// @author       awoo & Sacus
// @namespace    jpdb-nadeshiko-examples
// @match        https://jpdb.io/review*
// @match        https://jpdb.io/vocabulary/*
// @match        https://jpdb.io/kanji/*
// @match        https://jpdb.io/search*
// @match        https://jpdb.io/deck*
// @connect      api.nadeshiko.co
// @connect      cdn.nadeshiko.co
// @connect 	sargus.fr
// @grant        GM_addElement
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @license      MIT
// @downloadURL https://raw.githubusercontent.com/Sacus1/JPDB-Nadeshiko-Examples/refs/heads/main/JPDB%20nadeshiko%20Examples.js
// @updateURL https://raw.githubusercontent.com/Sacus1/JPDB-Nadeshiko-Examples/refs/heads/main/JPDB%20nadeshiko%20Examples.js
// ==/UserScript==
/*jshint esversion: 11 */
/* global GM_addElement, GM_xmlhttpRequest, GM_setValue, GM_getValue, GM_registerMenuCommand */
(function () {
    'use strict';
    let nadeshikoApiKey = GM_getValue("nadeshiko-api-key", "");
    const apiBaseUrl = "http://sargus.fr:8000/api";

    // Register menu commands
    GM_registerMenuCommand("Set Nadeshiko API Key", async () => {
        nadeshikoApiKey = fetchNadeshikoApiKey();
    });
    GM_registerMenuCommand("Open Configuration", () => {
        createOverlayMenu();
    });

    function fetchNadeshikoApiKey() {
        let apiKey = prompt("A Nadeshiko API key is required for this extension to work.\n\nYou can get one for free here after creating an account: https://nadeshiko.co/user/developer");
        GM_setValue("nadeshiko-api-key", apiKey);

        if (apiKey) {
            alert("API Key saved successfully!");
        }

        return apiKey;
    }

    // to use custom hotkeys just add them into this array following the same format. Any single keys except space
    // should work. If you want to use special keys, check the linked page for how to represent them in the array
    // (link leads to the arrow keys part so you can compare with the array and be sure which part to write):
    // https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values#navigation_keys
    const hotkeyOptions = ['None', 'ArrowLeft ArrowRight', ', .', '[ ]', 'Q W'];

    const CONFIG = {
        IMAGE_WIDTH: '400px',
        IMAGE_HEIGHT: '225px',
        WIDE_MODE: true,
        DEFINITIONS_ON_RIGHT_IN_WIDE_MODE: false,
        ARROW_WIDTH: '75px',
        ARROW_HEIGHT: '45px',
        PAGE_WIDTH: '75rem',
        SOUND_VOLUME: 80,
        ENABLE_EXAMPLE_TRANSLATION: true,
        SENTENCE_FONT_SIZE: '120%',
        TRANSLATION_FONT_SIZE: '85%',
        COLORED_SENTENCE_TEXT: true,
        AUTO_PLAY_SOUND: true,
        NUMBER_OF_PRELOADS: 1,
        VOCAB_SIZE: '250%',
        MINIMUM_EXAMPLE_LENGTH: 0,
        MAXIMUM_EXAMPLE_LENGTH: 100,
        HOTKEYS: ['ArrowLeft', 'ArrowRight'],
        BLUR_EXAMPLE_SENTENCE: true,
        FURIGANA_ON_BACKSIDE: true,
        FURIGANA_ON_FRONT_SIDE: false,
        // On changing this config option, the icons change but the sentences don't, so you
        // have to click once to match up the icons and again to actually change the sentences
        RANDOM_SENTENCE: false,
        WEIGHTED_SENTENCES: false,
        DEBUG: false, // Set to true to not use IndexedDB and always fetch from API
    };

    const state = {
        currentExampleIndex: 0,
        examples: [],
        apiDataFetched: false,
        vocab: '',
        embedAboveSubsectionMeanings: false,
        preloadedIndices: new Set(),
        currentAudio: null,
        audioGeneration: 0,
        error: false,
        currentlyPlayingAudio: false,
        reading: '',
        isFront : false,
    };

    // Prefixing
    const scriptPrefix = 'JPDBNadeshikoExamples-';
    const configPrefix = 'CONFIG.'; // additional prefix for config variables to go after the scriptPrefix
    // do not change either of the above without adding code to handle the change

    const setItem = (key, value) => {
        localStorage.setItem(scriptPrefix + key, value);
    };
    const getItem = (key) => {
        const prefixedValue = localStorage.getItem(scriptPrefix + key);
        if (prefixedValue !== null) {
            return prefixedValue;
        }
        const nonPrefixedValue = localStorage.getItem(key);
        // to move away from non-prefixed values as fast as possible
        if (nonPrefixedValue !== null) {
            setItem(key, nonPrefixedValue);
        }
        return nonPrefixedValue;
    };

    // Helper for transitioning to fully script-prefixed config state
    // Deletes all localStorage variables starting with configPrefix and re-adds them with scriptPrefix and configPrefix
    // Danger of other scripts also having localStorage variables starting with configPrefix, so we add a flag showing that
    // we have run this function and make sure it is not set when running it

    // Check for Prefixed flag
    if (localStorage.getItem(`JPDBNadeshiko*Examples-CONFIG_VARIABLES_PREFIXED`) !== 'true') {
        const keysToModify = [];

        // Collect keys that need to be modified
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith(configPrefix)) {
                keysToModify.push(key);
            }
        }

        // Modify the collected keys
        keysToModify.forEach((key) => {
            const value = localStorage.getItem(key);
            localStorage.removeItem(key);
            const newKey = scriptPrefix + key;
            localStorage.setItem(newKey, value);
        });
        // Set flag so this only runs once
        // Flag has * in name to place at top in alphabetical sorting,
        // and most importantly, to ensure the flag is never removed or modified
        // by the other script functions that check for the script prefix
        localStorage.setItem(`JPDBNadeshiko*Examples-CONFIG_VARIABLES_PREFIXED`, 'true');
    }

    // IndexedDB Manager
    const IndexedDBManager = {
        MAX_ENTRIES: 100000000,
        EXPIRATION_TIME: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds

        open() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open('NadeshikoDB', 1);
                request.onupgradeneeded = function (event) {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains('dataStore')) {
                        db.createObjectStore('dataStore', {keyPath: 'keyword'});
                    }
                };
                request.onsuccess = function (event) {
                    resolve(event.target.result);
                };
                request.onerror = function (event) {
                    reject('IndexedDB error: ' + event.target.errorCode);
                };
            });
        },

        get(db, keyword) {
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(['dataStore'], 'readonly');
                const store = transaction.objectStore('dataStore');
                const request = store.get(keyword);
                request.onsuccess = async function (event) {
                    const result = event.target.result;
                    if (result) {
                        const isExpired = Date.now() - result.timestamp >= this.EXPIRATION_TIME;
                        const validationError = validateApiResponse(result.data);

                        if (isExpired) {
                            console.log(`Deleting entry for keyword "${keyword}" because it is expired.`);
                            await this.deleteEntry(db, keyword);
                            resolve(null);
                        } else if (validationError && keyword !== 'jpdb-imported-data') {
                            console.error(`Deleting entry for keyword "${keyword}" due to validation error: ${validationError}`);
                            await this.deleteEntry(db, keyword);
                            resolve(null);
                        } else {
                            resolve([result.data,result.timestamp]);
                        }
                    } else {
                        resolve(null);
                    }
                }.bind(this);
                request.onerror = function (event) {
                    reject('IndexedDB get error: ' + event.target.errorCode);
                };
            });
        },

        deleteEntry(db, keyword) {
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(['dataStore'], 'readwrite');
                const store = transaction.objectStore('dataStore');
                const request = store.delete(keyword);
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject('IndexedDB delete error: ' + e.target.errorCode);
            });
        },

        getAll(db) {
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(['dataStore'], 'readonly');
                const store = transaction.objectStore('dataStore');
                const entries = [];
                store.openCursor().onsuccess = function (event) {
                    const cursor = event.target.result;
                    if (cursor) {
                        entries.push(cursor.value);
                        cursor.continue();
                    } else {
                        resolve(entries);
                    }
                };
                store.openCursor().onerror = function (event) {
                    reject('Failed to retrieve entries via cursor: ' + event.target.errorCode);
                };
            });
        },

        save(db, keyword, data) {
            return new Promise(async (resolve, reject) => {
                try {
                    const validationError = validateApiResponse(data);
                    if (validationError) {
                        console.error(`Invalid data detected: ${validationError}. Not saving to IndexedDB.`);
                        resolve();
                        return;
                    }
                    // check for DEBUG mode
                    if (CONFIG.DEBUG) {
                        console.log('DEBUG mode is enabled. Not using IndexedDB, always fetching from API.');
                        resolve();
                        return;
                    }
                    // Transform the JSON object to slim it down
                    let slimData = {};
                    if (data) {
                        slimData = data;
                    } else {
                        console.error('Data does not contain expected structure. Cannot slim down.');
                        resolve();
                        return;
                    }

                    const entries = await this.getAll(db);
                    const transaction = db.transaction(['dataStore'], 'readwrite');
                    const store = transaction.objectStore('dataStore');

                    if (entries.length >= this.MAX_ENTRIES) {
                        // Sort entries by timestamp and delete oldest ones
                        entries.sort((a, b) => a.timestamp - b.timestamp);
                        const entriesToDelete = entries.slice(0, entries.length - this.MAX_ENTRIES + 1);

                        // Delete old entries
                        entriesToDelete.forEach(entry => {
                            store.delete(entry.keyword).onerror = function () {
                                console.error('Failed to delete entry:', entry.keyword);
                            };
                        });
                    }

                    // Add the new slimmed entry
                    const addRequest = store.put({keyword, data: slimData, timestamp: Date.now()});
                    addRequest.onsuccess = () => resolve();
                    addRequest.onerror = (e) => reject('IndexedDB save error: ' + e.target.errorCode);

                    transaction.oncomplete = function () {
                        console.log('IndexedDB updated successfully.');
                    };

                    transaction.onerror = function (event) {
                        reject('IndexedDB update failed: ' + event.target.errorCode);
                    };

                } catch (error) {
                    reject(`Error in saveToIndexedDB: ${error}`);
                }
            });
        },

        importJPDBData(db, data) {
            return new Promise(async (resolve, reject) => {
                try {
                    /* -------- 1. build slimData -------- */
                    const slimData = {};
                    if (data?.cards_vocabulary_jp_en) {
                        data.cards_vocabulary_jp_en.forEach(card => {
                            slimData[`${card.spelling}|${card.reading}`] = 1;
                        });
                    } else {
                        reject('Unexpected data format');
                        return;
                    }

                    if (CONFIG.DEBUG) {
                        resolve();
                        return;
                    }

                    /* -------- 2. read current amount first -------- */
                    const entries = await this.getAll(db);

                    /* -------- 3. open a fresh read-write tx -------- */
                    const tx = db.transaction(['dataStore'], 'readwrite');
                    const store = tx.objectStore('dataStore');

                    // delete oldest if over quota
                    if (entries.length >= this.MAX_ENTRIES) {
                        entries
                            .sort((a, b) => a.timestamp - b.timestamp)
                            .slice(0, entries.length - this.MAX_ENTRIES + 1)
                            .forEach(entry => store.delete(entry.keyword));
                    }

                    // add / replace the imported blob
                    store.put({
                        keyword: 'jpdb-imported-data',
                        data: slimData,
                        timestamp: Date.now()
                    });

                    tx.oncomplete = () => {
                        console.log('IndexedDB import OK');
                        resolve();
                    };
                    tx.onerror = e => {
                        reject('IndexedDB import failed: ' + e.target.error);
                    };

                } catch (err) {
                    reject(`Error in importJPDBData: ${err}`);
                }
            });
        },

        delete() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.deleteDatabase('NadeshikoDB');
                request.onsuccess = function () {
                    console.log('IndexedDB deleted successfully');
                    resolve();
                };
                request.onerror = function (event) {
                    console.error('Error deleting IndexedDB:', event.target.errorCode);
                    reject('Error deleting IndexedDB: ' + event.target.errorCode);
                };
                request.onblocked = function () {
                    console.warn('Delete operation blocked. Please close all other tabs with this site open and try again.');
                    reject('Delete operation blocked');
                };
            });
        }
    };


    // API FUNCTIONS=====================================================================================================================
    function getNadeshikoData(vocab, reading = state?.reading) {


        return new Promise(async (resolve, reject) => {
            const url = `https://api.nadeshiko.co/v1/search`;
            const maxRetries = 2;
            let attempt = 0;

            async function fetchData() {
                try {
                    const db = await IndexedDBManager.open();
                    const cachedDatas = await IndexedDBManager.get(db, vocab);
                    if (cachedDatas && Array.isArray(cachedDatas)) {
                        const timestamp = cachedDatas[1]
                        const cachedData = cachedDatas[0]
                        cachedData.push(timestamp)
                        console.log('Data retrieved from IndexedDB');
                        state.examples = cachedData;
                        console.log("Last updated: " + new Date(cachedData[cachedData.length - 1]).toLocaleString());
                        state.apiDataFetched = true;
                        resolve();
                    } else {
                        const data = JSON.stringify({
                            query: { search: vocab },
                            take: 25,
                            filters: {
                                segmentLengthChars: {
                                    min: CONFIG.MINIMUM_EXAMPLE_LENGTH,
                                    max: CONFIG.MAXIMUM_EXAMPLE_LENGTH
                                }
                            }
                        })
                        console.log(`Calling API for: ${vocab} with data ${data}`);
                        if (!nadeshikoApiKey) {
                            // Ask for API Key on search if not set to prevent 401 errors
                            nadeshikoApiKey = fetchNadeshikoApiKey();
                            if (!nadeshikoApiKey) {
                                return;
                            }
                        }

                        GM_xmlhttpRequest({
                            method: "POST",
                            url: url,
                            data: data,
                            headers:
                                {
                                    "Authorization": "Bearer " + nadeshikoApiKey,
                                    "Content-Type": "application/json"
                                },
                            onload: async function (response) {
                                if (response.status === 200) {
                                    const parsed = parseJSON(response.response);
                                    let jsonData = parsed.segments.map(seg => {
                                        const media = parsed.includes.media[seg.mediaPublicId];
                                        seg.mediaName = media ? media.nameRomaji : null;
                                        return seg;
                                    });
                                    const validationError = validateApiResponse(jsonData);
                                    if (!validationError) {
                                        state.apiDataFetched = true;
                                        console.log(jsonData)
                                        // check if the sentence is in the vocab
                                        const sentenceResults = await Promise.all(
                                            jsonData.map(async sentence => {
                                                return await preprocessSentence(sentence, reading, vocab);
                                            }))
                                        jsonData = sentenceResults.filter(s => s);
                                        if (jsonData && jsonData.length > 0) {
                                            // Keep the default JPDB sentence (first item) and replace the rest
                                            const defaultExample = state.examples.find(e => e.isJpdbDefault);
                                            state.examples = defaultExample ? [defaultExample, ...jsonData] : jsonData;
                                        }
                                        resolve();
                                    } else {
                                        attempt++;
                                        if (attempt < maxRetries) {
                                            console.log(`Validation error: ${validationError}. Retrying... (${attempt}/${maxRetries})`);
                                            setTimeout(fetchData, 5000); // Add a 5-second delay before retrying
                                        } else {
                                            reject(`Invalid API response after ${maxRetries} attempts: ${validationError}`);
                                            state.error = true;
                                            embedImageAndPlayAudio(); //update displayed text
                                        }
                                    }
                                } else {
                                    console.error(`Failed to call api :`);
                                    console.error(response);
                                    reject(`API call failed with status: ${response.status}`);
                                }
                            },
                            onerror: function (error) {
                                reject(`An error occurred: ${error}`);
                            }
                        });
                    }
                } catch (error) {
                    reject(`Error: ${error}`);
                }
            }

            await fetchData();
        });
    }

    function parseJSON(responseText) {
        try {
            return JSON.parse(responseText);
        } catch (e) {
            console.error('Error parsing JSON:', e);
            return null;
        }
    }

    function validateApiResponse(jsonData) {
        state.error = false;
        if (!jsonData) {
            return 'Not a valid JSON';
        }
        const categoryCount = jsonData.length;
        if (!categoryCount) {
            return 'Missing category count';
        }

        // Check if all category counts are zero
        const allZero = categoryCount === 0;
        if (allZero) {
            return 'Blank API';
        }

        // Reject old-format cache entries (pre-v2 API) so they are naturally evicted
        if (jsonData[0] && jsonData[0].segment_info !== undefined) {
            return 'Stale cache format';
        }

        return null; // No error
    }

    async function checkIfNames(sargusData) {
        return await new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: apiBaseUrl + "/check_names",
                data: JSON.stringify(sargusData),
                headers: {
                    "Content-Type": "application/json"
                },
                onload: function (response) {
                    if (response.status === 200) {
                        try {
                            const names = JSON.parse(response.responseText);
                            if (Array.isArray(names)) {
                                resolve(names);
                            } else {
                                console.error("Invalid response format, expected an array:", names);
                                reject(null);
                            }
                        } catch (e) {
                            console.error("Error parsing response as JSON:", e);
                            reject(null);
                        }
                    } else {
                        console.error("Error checking if names :", response.responseText);
                        reject(null);
                    }
                }
            });
        });
    }

    function katakanaToHiragana(str) {
        const table = {'ア': 'あ', 'イ': 'い', 'ウ': 'う', 'エ': 'え', 'オ': 'お', 'カ': 'か', 'キ': 'き', 'ク': 'く', 'ケ': 'け', 'コ': 'こ', 'サ': 'さ', 'シ': 'し', 'ス': 'す', 'セ': 'せ', 'ソ': 'そ', 'タ': 'た', 'チ': 'ち', 'ツ': 'つ', 'テ': 'て', 'ト': 'と', 'ナ': 'な', 'ニ': 'に', 'ヌ': 'ぬ', 'ネ': 'ね', 'ノ': 'の', 'ハ': 'は', 'ヒ': 'ひ', 'フ': 'ふ', 'ヘ': 'へ', 'ホ': 'ほ', 'マ': 'ま', 'ミ': 'み', 'ム': 'む', 'メ': 'め', 'モ': 'も', 'ヤ': 'や', 'ユ': 'ゆ', 'ヨ': 'よ', 'ラ': 'ら', 'リ': 'り', 'ル': 'る', 'レ': 'れ', 'ロ': 'ろ', 'ワ': 'わ', 'ヲ': 'を', 'ン': 'ん', 'ァ': 'ぁ', 'ィ': 'ぃ', 'ゥ': 'ぅ', 'ェ': 'ぇ', 'ォ': 'ぉ', 'ャ': 'ゃ', 'ュ': 'ゅ', 'ョ': 'ょ', 'ヮ': 'ゎ', 'ッ': 'っ', 'ー': 'ー', 'ガ': 'が', 'ギ': 'ぎ', 'グ': 'ぐ', 'ゲ': 'げ', 'ゴ': 'ご', 'ザ': 'ざ', 'ジ': 'じ', 'ズ': 'ず', 'ゼ': 'ぜ', 'ゾ': 'ぞ', 'ダ': 'だ', 'ヂ': 'ぢ', 'ヅ': 'づ', 'デ': 'で', 'ド': 'ど', 'バ': 'ば', 'ビ': 'び', 'ブ': 'ぶ', 'ベ': 'べ', 'ボ': 'ぼ', 'パ': 'ぱ', 'ピ': 'ぴ', 'プ': 'ぷ', 'ペ': 'ぺ', 'ポ': 'ぽ', 'ヴ': 'ゔ'}
        return str.split('').map(char => table[char] || char).join('');
    }

    async function preprocessSentence(sentence, reading_ = state.reading, vocab_ = state.vocab) {
        const content = sentence.textJa?.content;
        // Set weights for each sentence by calling checking jpdb history data
        const db = await IndexedDBManager.open();
        let datas = (await IndexedDBManager.get(db, "jpdb-imported-data"));
        if (CONFIG.WEIGHTED_SENTENCES && datas && datas[0]) {
            datas = datas[0];
            let vocabInSentence = false;
            await processJPDBData(sentence);

            async function processJPDBData(sentence) {
                return await new Promise((resolve) => {
                    GM_xmlhttpRequest({
                        method: "POST",
                        url: apiBaseUrl + "/parse",
                        data: JSON.stringify({
                            "sentence": content,
                        }),
                        headers: {
                            "Content-Type": "application/json"
                        },
                        onload: function (response) {
                            let weight = 1;
                            if (response.status === 200) {
                                try {
                                    const vocab = JSON.parse(response.responseText);
                                    if (vocab.length > 0) {
                                        let matchCount = 0;
                                        let furi_sentence = ""
                                        const difficulty = vocab[0].split(' ')[2];
                                        for (const item of vocab) {
                                            const spelling = item.split(' ')[0];
                                            const reading = katakanaToHiragana(item.split(' ')[1]) || '';
											const specialChars = ['ー', '、', '。','─','》','《']; // extend as needed
											  if (specialChars.includes(spelling)) {
											    furi_sentence += `<ruby>${spelling}</ruby>`;
											  } else {
											    furi_sentence += `<ruby>${spelling}<rt>${reading}</rt></ruby>`;
											  }
                                            vocabInSentence = true;
                                            if (!reading_) {
                                                vocabInSentence = true;
                                            } else if (spelling && reading && (spelling.includes(vocab_) && reading.includes(reading_))) {
                                                vocabInSentence = true;
                                            }
                                            if (datas && datas[`${spelling}|${reading}`] !== undefined) {
                                                matchCount += datas[`${spelling}|${reading}`];
                                            }
                                        }
                                        sentence.furi_sentence = furi_sentence;
                                        // increase weight when ratio of matched vocab to total vocab is high and reduce when difficuly is high
                                        weight = Math.min(1, matchCount / vocab.length);
                                        weight = Math.min(1, weight * (1 - (parseInt(difficulty) / 10)));
                                        console.log(`Sentence "${content}" has weight: ${weight.toFixed(2)} based on ${matchCount} matches out of ${vocab.length} vocab items with difficulty ${difficulty}.`);
                                    }
                                    else {
                                        console.error("Error parsing parse response, got empty vocab array :", response.responseText);
                                        sentence.weight = -10
                                    }
                                } catch (e) {
                                    console.error("Error parsing parse response, got :",response.responseText, e);
                                }
                            }
                            else {
                                console.error("Error parsing parse response :", response.responseText);
                            }
                            sentence.weight = weight;
                            resolve();
                        },
                        onerror: function () {
                            sentence.weight = 1;
                            resolve();
                        }
                    });
                });
            }

            // if vocabInSentence is false, remove sentence from the examples
            if (!vocabInSentence) {
                console.log(`Skipping sentence "${content}" because it does not contain the vocab "${vocab_}" or reading "${reading_}".`);
                return null;
            }
        }
        else {
            sentence.weight = 1;
            console.log(`Skipping sentence "${content} because ${CONFIG.WEIGHTED_SENTENCES ? "no JPDB data found" : "weighting is disabled"}."`);
        }
        return sentence;
    }

    // PARSE VOCAB FUNCTIONS =====================================================================================================================
    function parseVocabFromAnswer() {
        // Select all links containing "/kanji/" or "/vocabulary/" in the href attribute
        const elements = document.querySelectorAll('a[href*="/kanji/"], a[href*="/vocabulary/"]');
        console.log("Parsing Answer Page");

        // Iterate through the matched elements
        for (const element of elements) {
            const href = element.getAttribute('href');
            const rubyElements = element.querySelectorAll('ruby');

            // Match the href to extract kanji or vocabulary (ignoring ID if present)
            const match = href.match(/\/(kanji|vocabulary)\/(?:\d+\/)?([^\#]*)#/);

            // If ruby elements exist, extract vocab and reading
            if (rubyElements.length > 0) {
                let vocabulary = "";
                const reading = Array.from(rubyElements)
                    .map(ruby => {
                        const rtElement = ruby.querySelector('rt');
                        vocabulary = vocabulary + (ruby.childNodes[0] ? ruby.childNodes[0].textContent.trim() : '');

                        if (rtElement) {
                            return rtElement.textContent.trim();
                        } else {
                            return ruby.textContent.trim();
                        }
                    })
                    .join('');

                return [vocabulary, reading];
            }

            // If match exists in href, return that as both vocab and reading
            if (match) {
                const vocab = match[2].trim();
                return [vocab, vocab];
            }

            // Return text content as both vocab and reading if nothing else found
            const text = element.textContent.trim();
            if (text) {
                return [text, text];
            }
        }
        return ['', ''];
    }

    function parseVocabFromReview() {
        console.log("Parsing Review Page");

        // Select the element with class 'kind' to determine the type of content
        const kindElement = document.querySelector('.kind');

        // If kindElement doesn't exist, set kindText to null
        const kindText = kindElement ? kindElement.textContent.trim() : null;

        // Accept 'Kanji' or 'Vocabulary' kindText
        if (kindText !== 'Kanji' && kindText !== 'Vocabulary') {
            console.log("Not Kanji or existing Vocabulary. Attempting to parse New Vocab.");

            // Attempt to parse from <a> tag with specific pattern
            const anchorElement = document.querySelector('a.plain[href*="/vocabulary/"]');

            if (anchorElement) {
                const href = anchorElement.getAttribute('href');

                const match = href.match(/\/vocabulary\/\d+\/([^#]+)#a/);

                if (match && match[1]) {
                    const new_vocab = match[1];
                    console.log("Found New Vocab:", new_vocab);
                    return new_vocab;
                }
            }

            console.log("No Vocabulary found.");
            return '';
        }

        if (kindText === 'Vocabulary') {
            // Select the element with class 'plain' to extract vocabulary
            const plainElement = document.querySelector('.plain');
            if (!plainElement) {
                return '';
            }
            const rubyElements = plainElement.querySelectorAll('ruby');
            // if not ruby elements, return the text content of the plain element twice (katakana word)
            if (rubyElements.length === 0) {
                const vocabText = plainElement.textContent.trim();
                console.log("Found Vocabulary:", vocabText);
                return [vocabText, vocabText];
            }
            // Extract the text from <rt> children and join them.
            let vocabulary = "";


            const reading = Array.from(rubyElements)
                .map(ruby => {
                    const rtElement = ruby.querySelector('rt');
                    // add the text not in the <rt> tag to the vocabulary
                    vocabulary = vocabulary + (ruby.childNodes[0] ? ruby.childNodes[0].textContent.trim() : '');

                    if (rtElement) {
                        rtElement.style.display = 'none';
                        return rtElement.textContent.trim();
                    } else {
                        return ruby.textContent.trim();
                    }
                })
                .join('');

            // Regular expression to check if the vocabulary contains kanji characters
            const kanjiRegex = /[\u4e00-\u9faf\u3400-\u4dbf]/;
            if (kanjiRegex.test(vocabulary) || vocabulary) {
                console.log("Found Vocabulary:", vocabulary);
                return [vocabulary, reading];
            }
        } else if (kindText === 'Kanji') {
            // Select the hidden input element to extract kanji
            const hiddenInput = document.querySelector('input[name="c"]');
            if (!hiddenInput) {
                return '';
            }

            const vocab = hiddenInput.value.split(',')[1];
            const kanjiRegex = /[\u4e00-\u9faf\u3400-\u4dbf]/;
            if (kanjiRegex.test(vocab)) {
                console.log("Found Kanji:", vocab);
                return vocab;
            }
        }

        console.log("No Vocabulary or Kanji found.");
        return '';
    }

    function parseVocabFromVocabulary() {
        // Get the current URL
        let url = window.location.href;

        // Remove query parameters (e.g., ?lang=english) and fragment identifiers (#)
        url = url.split('?')[0].split('#')[0];

        // Match the URL structure for a vocabulary page
        const match = url.match(/https:\/\/jpdb\.io\/vocabulary\/(\d+)\/([^\#\/]*)\/([^\#\/]*)/);
        console.log("Parsing Vocabulary Page");

        if (match) {
            // Extract and decode the vocabulary part from the URL
            let vocab = match[2];
            state.embedAboveSubsectionMeanings = true; // Set state flag
            let reading = match[3];
            return [decodeURIComponent(vocab), decodeURIComponent(reading)];
        }

        // Return empty string if no match
        return '';
    }

    function parseVocabFromKanji() {
        // Get the current URL
        const url = window.location.href;

        // Match the URL structure for a kanji page
        const match = url.match(/https:\/\/jpdb\.io\/kanji\/(\d+)\/([^\#]*)#a/);
        console.log("Parsing Kanji Page");

        if (match) {
            // Extract and decode the kanji part from the URL
            let kanji = match[2];
            state.embedAboveSubsectionMeanings = true; // Set state flag
            kanji = kanji.split('/')[0];
            return decodeURIComponent(kanji);
        }

        // Return empty string if no match
        return '';
    }

    function parseVocabFromSearch() {
        // Get the current URL
        let url = window.location.href;

        // Match the URL structure for a search query, capturing the vocab between `?q=` and either `&` or `+`
        const match = url.match(/https:\/\/jpdb\.io\/search\?q=([^&+]*)/);
        console.log("Parsing Search Page");

        if (match) {
            // Extract and decode the vocabulary part from the URL
            let vocab = match[1];
            return decodeURIComponent(vocab);
        }

        // Return empty string if no match
        return '';
    }


    //EMBED FUNCTIONS=====================================================================================================================
    function createAnchor(marginLeft) {
        // Create and style an anchor element
        const anchor = document.createElement('a');
        anchor.href = '#';
        anchor.style.border = '0';
        anchor.style.display = 'inline-flex';
        anchor.style.verticalAlign = 'middle';
        anchor.style.marginLeft = marginLeft;
        return anchor;
    }

    function createIcon(iconClass, fontSize = '1.4rem', color = '#3d81ff') {
        // Create and style an icon element
        const icon = document.createElement('i');
        icon.className = iconClass;
        icon.style.fontSize = fontSize;
        icon.style.opacity = '1.0';
        icon.style.verticalAlign = 'baseline';
        icon.style.color = color;
        return icon;
    }

    function createSpeakerButton(soundUrl) {
        // Create a speaker button with an icon and click event for audio playback
        const anchor = createAnchor('0.5rem');
        const icon = createIcon('ti ti-volume');
        anchor.appendChild(icon);
        anchor.addEventListener('click', (event) => {
            event.preventDefault();
            playAudio(soundUrl);
        });
        return anchor;
    }

    function createMenuButton() {
        // Create a menu button with a dropdown menu
        const anchor = createAnchor('0.5rem');
        const menuIcon = document.createElement('span');
        menuIcon.innerHTML = '☰';

        // Style the menu icon
        menuIcon.style.fontSize = '1.4rem';
        menuIcon.style.color = '#3D8DFF';
        menuIcon.style.verticalAlign = 'middle';
        menuIcon.style.position = 'relative';
        menuIcon.style.top = '-2px';

        // Append the menu icon to the anchor and set up the click event to show the overlay menu
        anchor.appendChild(menuIcon);
        anchor.addEventListener('click', (event) => {
            event.preventDefault();
            const overlay = createOverlayMenu();
            document.body.appendChild(overlay);
        });

        return anchor;
    }

    function createTextButton(vocab) {
        // Create a text button for Nadeshiko
        const textButton = document.createElement('a');
        textButton.textContent = 'Search in Nadeshiko...';
        textButton.style.color = 'var(--subsection-label-color)';
        textButton.style.fontSize = '85%';
        textButton.style.marginRight = '0.5rem';
        textButton.style.verticalAlign = 'middle';
        textButton.href = `https://nadeshiko.co/search/${encodeURIComponent(vocab)}`;
        textButton.target = '_blank';
        return textButton;
    }

    function createButtonContainer(vocab) {
        // Create a container for all buttons
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'button-container';
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'space-between';
        buttonContainer.style.alignItems = 'center';
        buttonContainer.style.marginBottom = '5px';
        buttonContainer.style.lineHeight = '1.4rem';

        // Create individual buttons
        const menuButton = createMenuButton();
        const textButton = createTextButton(vocab);

        // Center the buttons within the container
        const centeredButtonsWrapper = document.createElement('div');
        centeredButtonsWrapper.style.display = 'flex';
        centeredButtonsWrapper.style.justifyContent = 'center';
        centeredButtonsWrapper.style.flex = '1';

        // Invisible spacer to balance the menu button and keep text centered
        const spacer = menuButton.cloneNode(true);
        spacer.style.visibility = 'hidden';

        centeredButtonsWrapper.append(textButton);
        buttonContainer.append(spacer, centeredButtonsWrapper, menuButton);

        return buttonContainer;
    }

    function stopCurrentAudio() {
        // Stop any currently playing audio
        if (state.currentAudio) {
            state.currentAudio.source.stop();
            state.currentAudio.context.close();
            state.currentAudio = null;
        }
    }

    function playAudio(soundUrl) {
        if (soundUrl) {
            stopCurrentAudio();
            state.currentlyPlayingAudio = true;
            const generation = ++state.audioGeneration;

            GM_xmlhttpRequest({
                method: 'GET',
                url: soundUrl,
                responseType: 'arraybuffer',
                onload: function (response) {
                    // Discard if a newer playAudio call was made while fetching
                    if (generation !== state.audioGeneration) return;

                    const AudioContext = window.AudioContext || window.webkitAudioContext;
                    const audioContext = new AudioContext();
                    audioContext.decodeAudioData(response.response, function (buffer) {
                        // Discard if a newer playAudio call was made while decoding
                        if (generation !== state.audioGeneration) {
                            audioContext.close();
                            return;
                        }

                        const source = audioContext.createBufferSource();
                        source.buffer = buffer;

                        const gainNode = audioContext.createGain();

                        // Connect the source to the gain node and the gain node to the destination
                        source.connect(gainNode);
                        gainNode.connect(audioContext.destination);

                        // Mute the first part and then ramp up the volume
                        gainNode.gain.setValueAtTime(0, audioContext.currentTime);
                        gainNode.gain.linearRampToValueAtTime(CONFIG.SOUND_VOLUME / 100, audioContext.currentTime + 0.1);

                        // Play the audio, skip the first part to avoid any "pop"
                        source.start(0, 0.05);

                        // Save the current audio context and source for stopping later
                        state.currentAudio = {
                            context: audioContext,
                            source: source
                        };

                        // Set currentlyPlayingAudio to false when the audio ends
                        source.onended = function () {
                            state.currentlyPlayingAudio = false;
                        };
                    }, function (error) {
                        console.error('Error decoding audio:', error);
                        state.currentlyPlayingAudio = false;
                    });
                },
                onerror: function (error) {
                    console.error('Error fetching audio:', error);
                    state.currentlyPlayingAudio = false;
                }
            });
        }
    }

    // has to be declared (referenced in multiple functions but definition requires variables local to one function)
    let hotkeysListener;

    function highlightVocab(text, highlight) {
        if (!CONFIG.COLORED_SENTENCE_TEXT || !text) return text;
        if (highlight) {
            // Use API-provided highlight, replacing <em> with colored span
            return highlight
                .replace(/<em>(.*?)<\/em>/g, '<span style="color: #3d81ff;">$1</span>')
                .replace(/<\/?mark>/g, '');
        }
        return text;
    }

    function renderImageAndPlayAudio(vocab, shouldAutoPlaySound) {
        // Always stop audio when navigating, even if the new example has no audio
        stopCurrentAudio();
        state.audioGeneration++;

        if (state.examples.length === 0) {
            console.log("No data");
            // replace text by no data
            const sentenceElement = document.querySelector('.sentence');
            if (sentenceElement) {
                    sentenceElement.textContent = 'NO DATA';
                // Update translation class content with actual translation text
                const translationElement = document.querySelector('.sentence-translation');
                if (translationElement) {
                    translationElement.remove()
                }
            }
            return;
        }
        const example = state.examples[state.currentExampleIndex] || {};

        // Don't render anything on the front side for the JPDB default sentence
        if (example.isJpdbDefault && state.isFront) {
            return;
        }

        const imageUrl = example.urls ? example.urls.imageUrl : null;
        const soundUrl = example.urls ? example.urls.audioUrl : null;
        const sentence = example.textJa ? example.textJa.content : null;
        const highlight = example.textJa ? example.textJa.highlight : null;
        const translation = example.textEn ? example.textEn.content : null;
        const sentence_furi = example.furi_sentence || sentence;
        const deck_name = example.mediaName || "Unknown Anime";
        console.log(sentence,state.isFront)
        // Add Nadeshiko speaker icon to the left of the sentence
        const existingSpeakerIcon = document.getElementById('nadeshiko-speaker');
        if (existingSpeakerIcon) existingSpeakerIcon.remove();
        // Update sentence class content with actual sentence text
        // Skip updating for JPDB default — it's already correctly displayed by JPDB
        const sentenceElement = document.querySelector('.sentence');
        // Lock the sentence area height before changing content to prevent layout shift
        const sentenceParent = sentenceElement ? (sentenceElement.closest('.card-sentence') || sentenceElement.parentElement) : null;
        const sentenceGrandparent = sentenceParent ? sentenceParent.parentElement : null;
        if (sentenceGrandparent) {
            sentenceGrandparent.style.minHeight = sentenceGrandparent.offsetHeight + 'px';
        }
        if (sentenceElement && example.isJpdbDefault) {
            // Restore original JPDB sentence and translation
            if (state.jpdbSentenceHtml) {
                sentenceElement.innerHTML = state.jpdbSentenceHtml;
            }
            const translationElement = document.querySelector('.sentence-translation');
            if (translationElement && state.jpdbTranslationText) {
                translationElement.textContent = state.jpdbTranslationText;
            } else if (translationElement) {
                translationElement.textContent = '';
            }
        } else if (sentenceElement && !example.isJpdbDefault) {
            if ((state.isFront && CONFIG.FURIGANA_ON_FRONT_SIDE) || (!state.isFront && CONFIG.FURIGANA_ON_BACKSIDE)) {
                sentenceElement.innerHTML = highlightVocab(sentence_furi, highlight);
            } else if (CONFIG.COLORED_SENTENCE_TEXT) {
                sentenceElement.innerHTML = highlightVocab(sentence, highlight);
            } else {
                sentenceElement.textContent = sentence;
            }
            // Add speaker icon to the left of the sentence, like JPDB does
            if (soundUrl) {
                const cardSentence = sentenceElement.closest('.card-sentence') || sentenceElement.parentElement;
                if (cardSentence) {
                    const speakerIcon = document.createElement('a');
                    speakerIcon.id = 'nadeshiko-speaker';
                    speakerIcon.href = '#';
                    speakerIcon.style.border = '0';
                    speakerIcon.style.display = 'inline-flex';
                    speakerIcon.style.verticalAlign = 'middle';
                    speakerIcon.style.marginRight = '0.3rem';
                    const icon = document.createElement('i');
                    icon.className = 'ti ti-volume';
                    icon.style.fontSize = '1.4rem';
                    icon.style.color = '#3d81ff';
                    speakerIcon.appendChild(icon);
                    speakerIcon.addEventListener('click', (event) => {
                        event.preventDefault();
                        playAudio(soundUrl);
                    });
                    cardSentence.insertBefore(speakerIcon, cardSentence.firstChild);
                }
            }
            // Update translation class content with actual translation text
            const translationElement = document.querySelector('.sentence-translation');
            if (translationElement) {
                if (translation) {
                    translationElement.textContent = translation;
                    if (CONFIG.BLUR_EXAMPLE_SENTENCE && !state.isFront) {
                        translationElement.classList.add('blur');
                        translationElement.onclick = function() { this.classList.remove('blur'); };
                        translationElement.onmouseover = function() { this.classList.remove('blur'); };
                    }
                } else {
                    translationElement.textContent = '';
                }
            }
            else if (!state.isFront && translation)
            {
                // get div above .card-sentence
                const divAbove = sentenceElement.parentElement.parentElement;
                if (divAbove) {
                    const translationDiv = document.createElement('div');
                    translationDiv.style.display = 'flex';
                    translationDiv.style.justifyContent = 'center';
                    if (CONFIG.BLUR_EXAMPLE_SENTENCE)
                        translationDiv.innerHTML = `<div class="sentence-translation blur" style="" onclick="this.classList.remove('blur');" onmouseover="this.classList.remove('blur');">${translation}</div>`;
                    else
                        translationDiv.innerHTML = `<div class="sentence-translation" style="">${translation}</div>`;
                    divAbove.appendChild(translationDiv);
                }
            }
        } else if (!example.isJpdbDefault) {
            const answerBox = document.querySelector('.answer-box');
            if (answerBox) {
                const sentenceDiv = document.createElement('div');
                sentenceDiv.id = 'nadeshiko-sentence';
                sentenceDiv.style.display = 'flex';
                sentenceDiv.style.justifyContent = 'center';
                let content;
                if ((state.isFront && CONFIG.FURIGANA_ON_FRONT_SIDE) || (!state.isFront && CONFIG.FURIGANA_ON_BACKSIDE)) {
                    content = highlightVocab(sentence_furi, highlight);
                } else {
                    content = highlightVocab(sentence, highlight);
                }
                const translationHtml = translation
                    ? `<div style="display: flex;justify-content: center;"><div class="sentence-translation${CONFIG.BLUR_EXAMPLE_SENTENCE ? ' blur' : ''}" style="" onclick="this.classList.remove('blur');" onmouseover="this.classList.remove('blur');">${translation}</div></div>`
                    : '';
                sentenceDiv.innerHTML = `<div style="display: flex;"><div style="display: flex; flex-direction: column;"><div style="display: flex; align-items: baseline; column-gap: 0.25rem;" class="card-sentence"><div class="sentence" style="margin-left: 0.3rem;">${content}</div><a class="icon-link" href="/edit-shown-sentence?v=1168870&amp;s=3448502455&amp;r=1858493110&amp;origin=%2Freview%3Fc%3Dvf%2C1168870%2C3448502455%26r%3D2"><i class="ti ti-pencil"></i></a></div>${translationHtml}</div></div>`;
                answerBox.appendChild(sentenceDiv);
            }
        }
        const storedValue = getItem(state.vocab);
        const isBlacklisted = storedValue && storedValue.split(',').length > 1 && parseInt(storedValue.split(',')[1], 10) === 2;
        // Remove any existing container
        removeExistingContainer();
        if (!shouldRenderContainer()) {
            return;
        }

        // Create and append the main wrapper and text button container
        const wrapperDiv = createWrapperDiv();
        const textDiv = createButtonContainer(vocab);
        wrapperDiv.appendChild(textDiv);

        // Fixed-size container for image/text to prevent layout shift
        const imageContainer = createImageContainer();

        const createTextElement = (text) => {
            const textElement = document.createElement('div');
            textElement.textContent = text;
            textElement.style.whiteSpace = 'pre'; // Ensures newlines are respected
            return textElement;
        };
        if (example.isJpdbDefault) {
            imageContainer.appendChild(createTextElement('JPDB Default Sentence'));
        } else if (state.apiDataFetched) {
            if (imageUrl) {
                const imageLink = document.createElement('a');
                imageLink.href = `https://nadeshiko.co/sentence/${example.publicId}`;
                imageLink.target = '_blank';
                imageLink.style.border = '0';
                imageLink.style.display = 'block';
                imageLink.style.width = '100%';
                imageLink.style.height = '100%';
                imageContainer.appendChild(imageLink);
                createImageElement(imageLink, imageUrl, vocab);
            } else {
                imageContainer.appendChild(createTextElement(`NO IMAGE\n(${deck_name})`));
            }
        } else if (!sentence) {
            imageContainer.appendChild(createTextElement('ERROR\nNO EXAMPLES FOUND\n\nRARE WORD OR NADESHIKO API IS TEMPORARILY DOWN'));
        } else {
            imageContainer.appendChild(createTextElement('LOADING'));
        }
        wrapperDiv.appendChild(imageContainer);


        // Create navigation elements
        const navigationDiv = createNavigationDiv();
        const leftArrow = createLeftArrow(vocab, shouldAutoPlaySound);
        const rightArrow = createRightArrow(vocab, shouldAutoPlaySound);

        const totalCount = state.examples.length;
        const currentDisplay = state.currentExampleIndex + 1;
        const counterText = document.createElement('span');
        counterText.textContent = `${currentDisplay} / ${totalCount}`;
        counterText.style.fontSize = '85%';
        counterText.style.color = 'var(--subsection-label-color)';
        counterText.style.margin = '0 10px';

        // Show anime name for current example
        const infoDiv = document.createElement('div');
        infoDiv.style.textAlign = 'center';
        infoDiv.style.fontSize = '80%';
        infoDiv.style.color = 'var(--subsection-label-color)';
        infoDiv.style.marginTop = '4px';
        if (deck_name && !example.isJpdbDefault) {
            const nameLink = document.createElement('a');
            nameLink.textContent = deck_name;
            nameLink.href = `https://nadeshiko.co/search?mediaId=${example.mediaPublicId}`;
            nameLink.target = '_blank';
            nameLink.style.color = 'inherit';
            nameLink.style.textDecoration = 'none';
            nameLink.style.cursor = 'pointer';
            infoDiv.appendChild(nameLink);
        }

        // Create and append the main container
        const containerDiv = createContainerDiv(leftArrow, wrapperDiv, rightArrow, counterText, infoDiv, navigationDiv);
        appendContainer(containerDiv);

        // Auto-play sound if configured
        if (CONFIG.AUTO_PLAY_SOUND && shouldAutoPlaySound) {
            playAudio(soundUrl);
        }

        // Link hotkeys
        if (CONFIG.HOTKEYS.indexOf("None") === -1) {
            const leftHotkey = CONFIG.HOTKEYS[0];
            const rightHotkey = CONFIG.HOTKEYS[1];

            hotkeysListener = (event) => {
                if (event.repeat) {
                    return;
                }
                switch (event.key.toLowerCase()) {
                    case leftHotkey.toLowerCase():
                        if (leftArrow.disabled) {
                            // listener gets removed, so need to re-add
                            window.addEventListener('keydown', hotkeysListener, {once: true});
                        } else {
                            leftArrow.click(); // don't need to re-add listener because renderImageAndPlayAudio() will run again
                        }
                        break;
                    case rightHotkey.toLowerCase():
                        if (rightArrow.disabled) {
                            // listener gets removed, so need to re-add
                            window.addEventListener('keydown', hotkeysListener, {once: true});
                        } else {
                            rightArrow.click(); // don't need to re-add listener because renderImageAndPlayAudio() will run again
                        }
                        break;
                    default:
                        // listener gets removed, so need to re-add
                        window.addEventListener('keydown', hotkeysListener, {once: true});
                }
            };

            window.addEventListener('keydown', hotkeysListener, {once: true});
        }
    }

    function removeExistingContainer() {
        // Remove the existing container if it exists
        const existingContainer = document.getElementById('nadeshiko-container');
        if (existingContainer) {
            existingContainer.remove();
        }
        const existingSentenceDiv = document.getElementById('nadeshiko-sentence');
        if (existingSentenceDiv) {
            existingSentenceDiv.remove();
        }
        window.removeEventListener('keydown', hotkeysListener);
    }

    function shouldRenderContainer() {
        // Determine if the container should be rendered based on the presence of certain elements
        const resultVocabularySection = document.querySelector('.result.vocabulary');
        const hboxWrapSection = document.querySelector('.hbox.wrap');
        const subsectionMeanings = document.querySelector('.subsection-meanings');
        const subsectionLabels = document.querySelectorAll('h6.subsection-label');
        return resultVocabularySection || hboxWrapSection || subsectionMeanings || subsectionLabels.length >= 3;
    }

    function createWrapperDiv() {
        // Create and style the wrapper div
        const wrapperDiv = document.createElement('div');
        wrapperDiv.id = 'image-wrapper';
        wrapperDiv.style.textAlign = 'center';
        wrapperDiv.style.padding = '5px 0';
        return wrapperDiv;
    }

    function createImageContainer() {
        // Fixed-size container for the image/text area to prevent layout shift
        const container = document.createElement('div');
        container.style.width = CONFIG.IMAGE_WIDTH;
        container.style.height = CONFIG.IMAGE_HEIGHT;
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.justifyContent = 'center';
        container.style.margin = '0 auto';
        container.style.marginBottom = '4px';
        container.style.overflow = 'hidden';
        container.style.border = '1px solid rgba(128, 128, 128, 0.3)';
        container.style.borderRadius = '4px';
        return container;
    }

    function createImageElement(wrapperDiv, imageUrl, vocab) {
        // Create and return an image element with specified attributes
        const searchVocab = vocab;
        const example = state.examples[state.currentExampleIndex] || {};
        const deck_name = example.mediaName || null;

        // Extract the file name from the URL
        let file_name = imageUrl.substring(imageUrl.lastIndexOf('/') + 1);

        // Remove prefixes "Anime_", "A_", or "Z" from the file name
        file_name = file_name.replace(/^(Anime_|A_|Z)/, '');

        const titleText = `${searchVocab} #${state.currentExampleIndex + 1} \n${deck_name} \n${file_name}`;

        return GM_addElement(wrapperDiv, 'img', {
            src: imageUrl,
            alt: 'Embedded Image',
            title: titleText,
            style: `width: 100%; height: 100%; object-fit: cover; cursor: pointer;`
        });
    }

    function createNavigationDiv() {
        // Create and style the navigation div
        const navigationDiv = document.createElement('div');
        navigationDiv.id = 'nadeshiko-embed';
        navigationDiv.style.display = 'flex';
        navigationDiv.style.justifyContent = 'center';
        navigationDiv.style.alignItems = 'center';
        navigationDiv.style.maxWidth = CONFIG.IMAGE_WIDTH;
        navigationDiv.style.margin = '0 auto';
        return navigationDiv;
    }

    function createLeftArrow(vocab, shouldAutoPlaySound) {
        // Create and configure the left arrow button
        const leftArrow = document.createElement('button');
        leftArrow.textContent = '<';
        leftArrow.style.marginRight = '10px';
        leftArrow.style.width = CONFIG.ARROW_WIDTH;
        leftArrow.style.height = CONFIG.ARROW_HEIGHT;
        leftArrow.style.lineHeight = '25px';
        leftArrow.style.textAlign = 'center';
        leftArrow.style.display = 'flex';
        leftArrow.style.justifyContent = 'center';
        leftArrow.style.alignItems = 'center';
        leftArrow.style.padding = '0'; // Remove padding
        leftArrow.disabled = state.currentExampleIndex === 0;
        leftArrow.addEventListener('click', () => {
            if (state.currentExampleIndex > 0) {
                state.currentExampleIndex--;
                renderImageAndPlayAudio(vocab, shouldAutoPlaySound);
                preloadImages();
            }
        });
        return leftArrow;
    }

    function createRightArrow(vocab, shouldAutoPlaySound) {
        // Create and configure the right arrow button
        const rightArrow = document.createElement('button');
        rightArrow.textContent = '>';
        rightArrow.style.marginLeft = '10px';
        rightArrow.style.width = CONFIG.ARROW_WIDTH;
        rightArrow.style.height = CONFIG.ARROW_HEIGHT;
        rightArrow.style.lineHeight = '25px';
        rightArrow.style.textAlign = 'center';
        rightArrow.style.display = 'flex';
        rightArrow.style.justifyContent = 'center';
        rightArrow.style.alignItems = 'center';
        rightArrow.style.padding = '0'; // Remove padding
        rightArrow.disabled = state.currentExampleIndex >= state.examples.length - 1;
        rightArrow.addEventListener('click', () => {
            if (state.currentExampleIndex < state.examples.length - 1) {
                state.currentExampleIndex++;
                renderImageAndPlayAudio(vocab, shouldAutoPlaySound);
                preloadImages();
            }
        });
        return rightArrow;
    }

    function createContainerDiv(leftArrow, wrapperDiv, rightArrow, counterText, infoDiv, navigationDiv) {
        // Create and configure the main container div
        const containerDiv = document.createElement('div');
        containerDiv.id = 'nadeshiko-container';
        containerDiv.style.display = 'flex';
        containerDiv.style.alignItems = 'center';
        containerDiv.style.justifyContent = 'center';
        containerDiv.style.flexDirection = 'column';
        containerDiv.style.width = CONFIG.IMAGE_WIDTH;
        containerDiv.style.margin = '0 auto';

        const arrowWrapperDiv = document.createElement('div');
        arrowWrapperDiv.style.display = 'flex';
        arrowWrapperDiv.style.alignItems = 'center';
        arrowWrapperDiv.style.justifyContent = 'center';

        arrowWrapperDiv.append(leftArrow, counterText, rightArrow);
        containerDiv.append(wrapperDiv, arrowWrapperDiv, infoDiv, navigationDiv);

        return containerDiv;
    }

    function appendContainer(containerDiv) {
        // Append the container div to the appropriate section based on configuration
        const resultVocabularySection = document.querySelector('.result.vocabulary');
        const hboxWrapSection = document.querySelector('.hbox.wrap');
        const subsectionMeanings = document.querySelector('.subsection-meanings');
        const subsectionComposedOfKanji = document.querySelector('.subsection-composed-of-kanji');
        const subsectionPitchAccent = document.querySelector('.subsection-pitch-accent');
        const subsectionLabels = document.querySelectorAll('h6.subsection-label');
        const vboxGap = document.querySelector('.vbox.gap');
        const styleSheet = document.querySelector('link[rel="stylesheet"]').sheet;

        if (CONFIG.WIDE_MODE && subsectionMeanings) {
            const wrapper = document.createElement('div');
            wrapper.style.display = 'flex';
            wrapper.style.alignItems = 'flex-start';
            if (CONFIG.DEFINITIONS_ON_RIGHT_IN_WIDE_MODE) {
                wrapper.style.gap = '40px';
            }
            styleSheet.insertRule('.subsection-meanings { max-width: none !important; }', styleSheet.cssRules.length);

            const originalContentWrapper = document.createElement('div');
            originalContentWrapper.style.flex = '1';
            originalContentWrapper.appendChild(subsectionMeanings);

            if (subsectionComposedOfKanji) {
                const newline1 = document.createElement('br');
                originalContentWrapper.appendChild(newline1);
                originalContentWrapper.appendChild(subsectionComposedOfKanji);
            }
            if (subsectionPitchAccent) {
                const newline2 = document.createElement('br');
                originalContentWrapper.appendChild(newline2);
                originalContentWrapper.appendChild(subsectionPitchAccent);
            }

            if (CONFIG.DEFINITIONS_ON_RIGHT_IN_WIDE_MODE) {
                wrapper.appendChild(containerDiv);
                wrapper.appendChild(originalContentWrapper);
            } else {
                wrapper.appendChild(originalContentWrapper);
                wrapper.appendChild(containerDiv);
            }

            if (vboxGap) {
                const existingDynamicDiv = vboxGap.querySelector('#dynamic-content');
                if (existingDynamicDiv) {
                    existingDynamicDiv.remove();
                }

                const dynamicDiv = document.createElement('div');
                dynamicDiv.id = 'dynamic-content';
                dynamicDiv.appendChild(wrapper);

                if (window.location.href.includes('vocabulary')) {
                    vboxGap.insertBefore(dynamicDiv, vboxGap.children[1]);
                } else {
                    vboxGap.insertBefore(dynamicDiv, vboxGap.firstChild);
                }
            }
        } else {
            if (state.embedAboveSubsectionMeanings && subsectionMeanings) {
                subsectionMeanings.parentNode.insertBefore(containerDiv, subsectionMeanings);
            } else if (resultVocabularySection) {
                resultVocabularySection.parentNode.insertBefore(containerDiv, resultVocabularySection);
            } else if (hboxWrapSection) {
                hboxWrapSection.parentNode.insertBefore(containerDiv, hboxWrapSection);
            } else if (subsectionLabels.length >= 4) {
                subsectionLabels[3].parentNode.insertBefore(containerDiv, subsectionLabels[3]);
            }
        }
    }

    function embedImageAndPlayAudio() {
        // Embed the image and play audio, removing existing navigation div if present
        console.log("Embedding image and playing audio");
        const existingNavigationDiv = document.getElementById('nadeshiko-embed');
        if (existingNavigationDiv) {
            existingNavigationDiv.remove();
        }

        const reviewUrlPattern = /https:\/\/jpdb\.io\/review(#a)?$/;

        renderImageAndPlayAudio(state.vocab, !reviewUrlPattern.test(window.location.href));
        preloadImages();
    }

    function preloadImages() {
        // Preload images around the current example index
        const preloadDiv = GM_addElement(document.body, 'div', {style: 'display: none;'});
        const startIndex = Math.max(0, state.currentExampleIndex - CONFIG.NUMBER_OF_PRELOADS);
        const endIndex = Math.min(state.examples.length - 1, state.currentExampleIndex + CONFIG.NUMBER_OF_PRELOADS);

        for (let i = startIndex; i <= endIndex; i++) {
            if (!state.preloadedIndices.has(i) && state.examples[i].urls && state.examples[i].urls.imageUrl) {
                GM_addElement(preloadDiv, 'img', {src: state.examples[i].urls.imageUrl});
                state.preloadedIndices.add(i);
            }
        }
    }


    //MENU FUNCTIONS=====================================================================================================================

    function handleImportDButtonClick() {
        handleFileInput('application/json', importData);
    }

    function handleFileInput(acceptType, callback) {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = acceptType;
        fileInput.addEventListener('change', callback);
        fileInput.click();
    }

    function createBlobAndDownload(data, filename, type) {
        const blob = new Blob([data], {type});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async function exportData() {
        const dataEntries = {};

        try {
            const db = await IndexedDBManager.open();
            const indexedDBData = await IndexedDBManager.getAll(db);
            indexedDBData.forEach(item => {
                dataEntries[item.keyword] = item.data;
            });

            const data = JSON.stringify(dataEntries, null, 2);
            createBlobAndDownload(data, 'data.json', 'application/json');
        } catch (error) {
            console.error('Error exporting data from IndexedDB:', error);
        }
    }

    async function importData(event) {
        const file = event.target.files[0];
        if (!file) {
            return;
        }

        const reader = new FileReader();
        reader.onload = async function (e) {
            try {
                const dataEntries = JSON.parse(e.target.result);

                const db = await IndexedDBManager.open();
                for (const key in dataEntries) {
                    await IndexedDBManager.save(db, key, dataEntries[key]);
                }

                alert('Data imported successfully!');
                location.reload();
            } catch (error) {
                alert('Error importing data:', error);
            }
        };
        reader.readAsText(file);
    }


    ////CONFIRMATION
    function createConfirmationPopup(messageText, onYes, onNo) {
        // Create a confirmation popup with Yes and No buttons
        const popupOverlay = document.createElement('div');
        popupOverlay.style.position = 'fixed';
        popupOverlay.style.top = '0';
        popupOverlay.style.left = '0';
        popupOverlay.style.width = '100%';
        popupOverlay.style.height = '100%';
        popupOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.75)';
        popupOverlay.style.zIndex = '1001';
        popupOverlay.style.display = 'flex';
        popupOverlay.style.justifyContent = 'center';
        popupOverlay.style.alignItems = 'center';

        const popupContent = document.createElement('div');
        popupContent.style.backgroundColor = 'var(--background-color)';
        popupContent.style.padding = '20px';
        popupContent.style.borderRadius = '5px';
        popupContent.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.5)';
        popupContent.style.textAlign = 'center';

        const message = document.createElement('p');
        message.textContent = messageText;

        const yesButton = document.createElement('button');
        yesButton.textContent = 'Yes';
        yesButton.style.backgroundColor = '#C82800';
        yesButton.style.marginRight = '10px';
        yesButton.addEventListener('click', () => {
            onYes();
            document.body.removeChild(popupOverlay);
        });

        const noButton = document.createElement('button');
        noButton.textContent = 'No';
        noButton.addEventListener('click', () => {
            onNo();
            document.body.removeChild(popupOverlay);
        });

        popupContent.appendChild(message);
        popupContent.appendChild(yesButton);
        popupContent.appendChild(noButton);
        popupOverlay.appendChild(popupContent);

        document.body.appendChild(popupOverlay);
    }

    ////BUTTONS
    function createActionButtonsContainer() {
        const actionButtonWidth = '100px';

        const closeButton = createButton('Close', '10px', closeOverlayMenu, actionButtonWidth);
        const saveButton = createButton('Save', '10px', saveConfig, actionButtonWidth);
        const defaultButton = createDefaultButton(actionButtonWidth);
        const deleteButton = createDeleteButton(actionButtonWidth);

        const actionButtonsContainer = document.createElement('div');
        actionButtonsContainer.style.textAlign = 'center';
        actionButtonsContainer.style.marginTop = '10px';
        actionButtonsContainer.append(closeButton, saveButton, defaultButton, deleteButton);

        return actionButtonsContainer;
    }

    function createMenuButtons() {
        const dataContainer = createDataContainer();
        const actionButtonsContainer = createActionButtonsContainer();

        const buttonContainer = document.createElement('div');
        buttonContainer.append(dataContainer, actionButtonsContainer);

        return buttonContainer;
    }

    function createButton(text, margin, onClick, width) {
        // Create a button element with specified properties
        const button = document.createElement('button');
        button.textContent = text;
        button.style.margin = margin;
        button.style.width = width;
        button.style.textAlign = 'center';
        button.style.display = 'inline-block';
        button.style.lineHeight = '30px';
        button.style.padding = '5px 0';
        button.addEventListener('click', onClick);
        return button;
    }

    ////DATA BUTTONS
    function createDataContainer() {
        const dataButtonWidth = '200px';

        const exportButton = createButton('Export Data', '10px', exportData, dataButtonWidth);
        const importButton = createButton('Import Data', '10px', handleImportDButtonClick, dataButtonWidth);

        const dataContainer = document.createElement('div');
        dataContainer.style.textAlign = 'center';
        dataContainer.style.marginTop = '10px';
        dataContainer.append(exportButton, importButton);

        return dataContainer;
    }

    ////CLOSE BUTTON
    function closeOverlayMenu() {
        loadConfig();
        document.body.removeChild(document.getElementById('overlayMenu'));
    }

    ////SAVE BUTTON
    function saveConfig() {
        const overlay = document.getElementById('overlayMenu');
        if (!overlay) {
            return;
        }

        const inputs = overlay.querySelectorAll('input, span');
        console.log(inputs);
        const {changes, minimumExampleLengthChanged, newMinimumExampleLength} = gatherChanges(inputs);
        if (minimumExampleLengthChanged) {
            handleMinimumExampleLengthChange(newMinimumExampleLength, changes);
        } else {
            applyChanges(changes);
            finalizeSaveConfig();
            setVocabSize();
            setPageWidth();
        }
    }

    function gatherChanges(inputs) {
        let minimumExampleLengthChanged = false;
        let newMinimumExampleLength;
        const changes = {};

        inputs.forEach(input => {
            const key = input.getAttribute('data-key');
            const type = input.getAttribute('data-type');
            let value;

            if (type === 'boolean') {
                value = input.checked;
            } else if (type === 'number') {
                value = parseFloat(input.textContent);
            } else if (type === 'string') {
                value = input.textContent;
            } else if (type === 'object' && key === 'HOTKEYS') {
                value = input.textContent.replace(' and ', ' ');
            }

            if (key && type) {
                const typePart = input.getAttribute('data-type-part');
                const originalFormattedType = typePart.slice(1, -1);

                if (key === 'MINIMUM_EXAMPLE_LENGTH' && CONFIG.MINIMUM_EXAMPLE_LENGTH !== value) {
                    minimumExampleLengthChanged = true;
                    newMinimumExampleLength = value;
                }
                if (key === 'MAXIMUM_EXAMPLE_LENGTH' && CONFIG.MAXIMUM_EXAMPLE_LENGTH !== value) {
                    value = Math.max(value, CONFIG.MINIMUM_EXAMPLE_LENGTH);
                }
                changes[configPrefix + key] = value + originalFormattedType;
            }
        });

        return {changes, minimumExampleLengthChanged, newMinimumExampleLength};
    }

    function handleMinimumExampleLengthChange(newMinimumExampleLength, changes) {
        createConfirmationPopup(
            'Changing Minimum Example Length will reset your cache and sentences will take longer to load at first Are you sure?',
            async () => {
                await IndexedDBManager.delete();
                CONFIG.MINIMUM_EXAMPLE_LENGTH = newMinimumExampleLength;
                setItem(`${configPrefix}MINIMUM_EXAMPLE_LENGTH`, newMinimumExampleLength);
                applyChanges(changes);
                clearNonConfigLocalStorage();
                finalizeSaveConfig();
                location.reload();
            },
            () => {
                const overlay = document.getElementById('overlayMenu');
                document.body.removeChild(overlay);
                document.body.appendChild(createOverlayMenu());
            }
        );
    }

    function clearNonConfigLocalStorage() {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(scriptPrefix) && !key.startsWith(scriptPrefix + configPrefix)) {
                localStorage.removeItem(key);
                i--; // Adjust index after removal
            }
        }
    }

    function applyChanges(changes) {
        for (const key in changes) {
            setItem(key, changes[key]);
        }
    }

    function finalizeSaveConfig() {
        loadConfig();
        window.removeEventListener('keydown', hotkeysListener);
        renderImageAndPlayAudio(state.vocab, CONFIG.AUTO_PLAY_SOUND);
        const overlay = document.getElementById('overlayMenu');
        if (overlay) {
            document.body.removeChild(overlay);
        }
    }


    ////DEFAULT BUTTON
    function createDefaultButton(width) {
        const defaultButton = createButton('Default', '10px', () => {
            createConfirmationPopup(
                'This will reset all your settings to default. Are you sure?',
                () => {
                    Object.keys(localStorage).forEach(key => {
                        if (key.startsWith(scriptPrefix + configPrefix)) {
                            localStorage.removeItem(key);
                        }
                    });
                    location.reload();
                },
                () => {
                    const overlay = document.getElementById('overlayMenu');
                    if (overlay) {
                        document.body.removeChild(overlay);
                    }
                    loadConfig();
                    document.body.appendChild(createOverlayMenu());
                }
            );
        }, width);
        defaultButton.style.backgroundColor = '#C82800';
        defaultButton.style.color = 'white';
        return defaultButton;
    }


    ////DELETE BUTTON
    function createDeleteButton(width) {
        const deleteButton = createButton('DELETE', '10px', () => {
            createConfirmationPopup(
                'This will delete all cached data. Are you sure?',
                async () => {
                    await IndexedDBManager.delete();
                    Object.keys(localStorage).forEach(key => {
                        if (key.startsWith(scriptPrefix) && !key.startsWith(scriptPrefix + configPrefix)) {
                            localStorage.removeItem(key);
                        }
                    });
                    location.reload();
                },
                () => {
                    const overlay = document.getElementById('overlayMenu');
                    if (overlay) {
                        document.body.removeChild(overlay);
                    }
                    loadConfig();
                    document.body.appendChild(createOverlayMenu());
                }
            );
        }, width);
        deleteButton.style.backgroundColor = '#C82800';
        deleteButton.style.color = 'white';
        return deleteButton;
    }

    function createOverlayMenu() {
        // Create and return the overlay menu for configuration settings
        const overlay = document.createElement('div');
        overlay.id = 'overlayMenu';
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.75)';
        overlay.style.zIndex = '1000';
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';

        const menuContent = document.createElement('div');
        menuContent.style.backgroundColor = 'var(--background-color)';
        menuContent.style.color = 'var(--text-color)';
        menuContent.style.padding = '20px';
        menuContent.style.borderRadius = '5px';
        menuContent.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.5)';
        menuContent.style.width = '80%';
        menuContent.style.maxWidth = '550px';
        menuContent.style.maxHeight = '80%';
        menuContent.style.overflowY = 'auto';
        // Make a button to upload the json history file
        const uploadButton = document.createElement('button');
        uploadButton.textContent = 'Upload History JSON';
        uploadButton.style.margin = '10px';
        uploadButton.addEventListener('click', async () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.json';
            fileInput.style.display = 'none';
            fileInput.addEventListener('change', async (event) => {
                const file = event.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = async (e) => {
                        try {
                            const data = JSON.parse(e.target.result);
                            console.log('Parsed data:', data);
                            const db = await IndexedDBManager.open();
                            await IndexedDBManager.importJPDBData(db, data).then(() => {
                                    alert('History imported successfully!');
                                    // Reload the page to reflect changes
                                    location.reload();
                                }
                            ).catch((error) => {
                                console.error('Error importing data:', error);
                                alert('Failed to import history. Please check the console for details.');
                                console.log(data);

                            });
                        } catch (error) {
                            console.error('Error parsing JSON:', error);
                            alert('Invalid JSON file. Please upload a valid JPDB history file.');
                            console.log(data);
                        }
                    };
                    reader.readAsText(file);
                }
            });
            document.body.appendChild(fileInput);
            fileInput.click();
        })
        menuContent.appendChild(uploadButton);
        for (const [key, value] of Object.entries(CONFIG)) {
            const optionContainer = document.createElement('div');
            optionContainer.style.marginBottom = '10px';
            optionContainer.style.display = 'flex';
            optionContainer.style.alignItems = 'center';

            const leftContainer = document.createElement('div');
            leftContainer.style.flex = '1';
            leftContainer.style.display = 'flex';
            leftContainer.style.alignItems = 'center';

            const rightContainer = document.createElement('div');
            rightContainer.style.flex = '1';
            rightContainer.style.display = 'flex';
            rightContainer.style.alignItems = 'center';
            rightContainer.style.justifyContent = 'center';

            const label = document.createElement('label');
            label.textContent = key.replace(/_/g, ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
            label.style.marginRight = '10px';

            leftContainer.appendChild(label);

            if (typeof value === 'boolean') {
                const checkboxContainer = document.createElement('div');
                checkboxContainer.style.display = 'flex';
                checkboxContainer.style.alignItems = 'center';
                checkboxContainer.style.justifyContent = 'center';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = value;
                checkbox.setAttribute('data-key', key);
                checkbox.setAttribute('data-type', 'boolean');
                checkbox.setAttribute('data-type-part', '');
                checkboxContainer.appendChild(checkbox);

                rightContainer.appendChild(checkboxContainer);
            } else if (typeof value === 'number') {
                const numberContainer = document.createElement('div');
                numberContainer.style.display = 'flex';
                numberContainer.style.alignItems = 'center';
                numberContainer.style.justifyContent = 'center';

                const decrementButton = document.createElement('button');
                decrementButton.textContent = '-';
                decrementButton.style.marginRight = '5px';

                const input = document.createElement('span');
                input.textContent = value;
                input.style.margin = '0 10px';
                input.style.minWidth = '3ch';
                input.style.textAlign = 'center';
                input.setAttribute('data-key', key);
                input.setAttribute('data-type', 'number');
                input.setAttribute('data-type-part', '');

                const incrementButton = document.createElement('button');
                incrementButton.textContent = '+';
                incrementButton.style.marginLeft = '5px';

                const updateButtonStates = () => {
                    let currentValue = parseFloat(input.textContent);
                    if (currentValue <= 0) {
                        decrementButton.disabled = true;
                        decrementButton.style.color = 'grey';
                    } else {
                        decrementButton.disabled = false;
                        decrementButton.style.color = '';
                    }
                    if (key === 'SOUND_VOLUME' && currentValue >= 100) {
                        incrementButton.disabled = true;
                        incrementButton.style.color = 'grey';
                    } else {
                        incrementButton.disabled = false;
                        incrementButton.style.color = '';
                    }
                };

                decrementButton.addEventListener('click', () => {
                    let currentValue = parseFloat(input.textContent);
                    if (currentValue > 0) {
                        if (currentValue > 200) {
                            input.textContent = currentValue - 25;
                        } else if (currentValue > 20) {
                            input.textContent = currentValue - 5;
                        } else {
                            input.textContent = currentValue - 1;
                        }
                        updateButtonStates();
                    }
                });

                incrementButton.addEventListener('click', () => {
                    let currentValue = parseFloat(input.textContent);
                    if (key === 'SOUND_VOLUME' && currentValue >= 100) {
                        return;
                    }
                    if (currentValue >= 200) {
                        input.textContent = currentValue + 25;
                    } else if (currentValue >= 20) {
                        input.textContent = currentValue + 5;
                    } else {
                        input.textContent = currentValue + 1;
                    }
                    updateButtonStates();
                });

                numberContainer.appendChild(decrementButton);
                numberContainer.appendChild(input);
                numberContainer.appendChild(incrementButton);

                rightContainer.appendChild(numberContainer);

                // Initialize button states
                updateButtonStates();
            } else if (typeof value === 'string') {
                const typeParts = value.split(/(\d+)/).filter(Boolean);
                const numberParts = typeParts.filter(part => !isNaN(part)).map(Number);

                const numberContainer = document.createElement('div');
                numberContainer.style.display = 'flex';
                numberContainer.style.alignItems = 'center';
                numberContainer.style.justifyContent = 'center';

                const typeSpan = document.createElement('span');
                const formattedType = '(' + typeParts.filter(part => isNaN(part)).join('').replace(/_/g, ' ').toLowerCase() + ')';
                typeSpan.textContent = formattedType;
                typeSpan.style.marginRight = '10px';

                leftContainer.appendChild(typeSpan);

                typeParts.forEach(part => {
                    if (!isNaN(part)) {
                        const decrementButton = document.createElement('button');
                        decrementButton.textContent = '-';
                        decrementButton.style.marginRight = '5px';

                        const input = document.createElement('span');
                        input.textContent = part;
                        input.style.margin = '0 10px';
                        input.style.minWidth = '3ch';
                        input.style.textAlign = 'center';
                        input.setAttribute('data-key', key);
                        input.setAttribute('data-type', 'string');
                        input.setAttribute('data-type-part', formattedType);

                        const incrementButton = document.createElement('button');
                        incrementButton.textContent = '+';
                        incrementButton.style.marginLeft = '5px';

                        const updateButtonStates = () => {
                            let currentValue = parseFloat(input.textContent);
                            if (currentValue <= 0) {
                                decrementButton.disabled = true;
                                decrementButton.style.color = 'grey';
                            } else {
                                decrementButton.disabled = false;
                                decrementButton.style.color = '';
                            }
                            if (key === 'SOUND_VOLUME' && currentValue >= 100) {
                                incrementButton.disabled = true;
                                incrementButton.style.color = 'grey';
                            } else {
                                incrementButton.disabled = false;
                                incrementButton.style.color = '';
                            }
                        };

                        decrementButton.addEventListener('click', () => {
                            let currentValue = parseFloat(input.textContent);
                            if (currentValue > 0) {
                                if (currentValue > 200) {
                                    input.textContent = currentValue - 25;
                                } else if (currentValue > 20) {
                                    input.textContent = currentValue - 5;
                                } else {
                                    input.textContent = currentValue - 1;
                                }
                                updateButtonStates();
                            }
                        });

                        incrementButton.addEventListener('click', () => {
                            let currentValue = parseFloat(input.textContent);
                            if (key === 'SOUND_VOLUME' && currentValue >= 100) {
                                return;
                            }
                            if (currentValue >= 200) {
                                input.textContent = currentValue + 25;
                            } else if (currentValue >= 20) {
                                input.textContent = currentValue + 5;
                            } else {
                                input.textContent = currentValue + 1;
                            }
                            updateButtonStates();
                        });

                        numberContainer.appendChild(decrementButton);
                        numberContainer.appendChild(input);
                        numberContainer.appendChild(incrementButton);

                        // Initialize button states
                        updateButtonStates();
                    }
                });

                rightContainer.appendChild(numberContainer);
            } else if (typeof value === 'object') {
                const maxAllowedIndex = hotkeyOptions.length - 1;

                let currentValue = value;
                let choiceIndex = hotkeyOptions.indexOf(currentValue.join(' '));
                if (choiceIndex === -1) {
                    currentValue = hotkeyOptions[0].split(' ');
                    choiceIndex = 0;
                }
                const textContainer = document.createElement('div');
                textContainer.style.display = 'flex';
                textContainer.style.alignItems = 'center';
                textContainer.style.justifyContent = 'center';

                const decrementButton = document.createElement('button');
                decrementButton.textContent = '<';
                decrementButton.style.marginRight = '5px';

                const input = document.createElement('span');
                input.textContent = currentValue.join(' and ');
                input.style.margin = '0 10px';
                input.style.minWidth = '3ch';
                input.style.textAlign = 'center';
                input.setAttribute('data-key', key);
                input.setAttribute('data-type', 'object');
                input.setAttribute('data-type-part', '');

                const incrementButton = document.createElement('button');
                incrementButton.textContent = '>';
                incrementButton.style.marginLeft = '5px';

                const updateButtonStates = () => {
                    if (choiceIndex <= 0) {
                        decrementButton.disabled = true;
                        decrementButton.style.color = 'grey';
                    } else {
                        decrementButton.disabled = false;
                        decrementButton.style.color = '';
                    }
                    if (choiceIndex >= maxAllowedIndex) {
                        incrementButton.disabled = true;
                        incrementButton.style.color = 'grey';
                    } else {
                        incrementButton.disabled = false;
                        incrementButton.style.color = '';
                    }
                };

                decrementButton.addEventListener('click', () => {
                    if (choiceIndex > 0) {
                        choiceIndex -= 1;
                        currentValue = hotkeyOptions[choiceIndex].split(' ');
                        input.textContent = currentValue.join(' and ');
                        updateButtonStates();
                    }
                });

                incrementButton.addEventListener('click', () => {
                    if (choiceIndex < maxAllowedIndex) {
                        choiceIndex += 1;
                        currentValue = hotkeyOptions[choiceIndex].split(' ');
                        input.textContent = currentValue.join(' and ');
                        updateButtonStates();
                    }
                });

                textContainer.appendChild(decrementButton);
                textContainer.appendChild(input);
                textContainer.appendChild(incrementButton);

                // Initialize button states
                updateButtonStates();

                rightContainer.appendChild(textContainer);
            }

            optionContainer.appendChild(leftContainer);
            optionContainer.appendChild(rightContainer);
            menuContent.appendChild(optionContainer);
        }

        const menuButtons = createMenuButtons();
        menuContent.appendChild(menuButtons);

        overlay.appendChild(menuContent);

        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeOverlayMenu();
            }
        });
        overlay.tabIndex = -1;
        requestAnimationFrame(() => overlay.focus());

        return overlay;
    }

    function loadConfig() {
        for (const key in localStorage) {
            if (!key.startsWith(scriptPrefix + configPrefix) || !localStorage.hasOwnProperty(key)) {
                continue;
            }


            const configKey = key.substring((scriptPrefix + configPrefix).length); // chop off script prefix and config prefix
            if (!CONFIG.hasOwnProperty(configKey)) {
                continue;
            }


            const savedValue = localStorage.getItem(key);
            if (savedValue === null) {
                continue;
            }


            const valueType = typeof CONFIG[configKey];
            if (configKey === 'HOTKEYS') {
                CONFIG[configKey] = savedValue.split(' ');
            } else if (valueType === 'boolean') {
                CONFIG[configKey] = savedValue === 'true';
            } else if (valueType === 'number') {
                CONFIG[configKey] = parseFloat(savedValue);
            } else if (valueType === 'string') {
                CONFIG[configKey] = savedValue;
            }
        }
    }


    async function process_sentences(state, sentences) {
        // Early return for empty array or single item (no processing needed)
        if (!sentences || !Array.isArray(sentences) || sentences.length <= 1) {
            return sentences;
        }
        // Only randomize if needed
        const shouldRandomize = CONFIG.RANDOM_SENTENCE;

        // Skip weight calculation if not needed
        if (!CONFIG.WEIGHTED_SENTENCES && !shouldRandomize) {
            return sentences;
        }

        // if timestamp is set and less than 30 seconds ago, skip
        const lastEntry = sentences[sentences.length -1 ];
        // log copy of sentences
        console.log(Array.from(sentences));
        console.log(lastEntry);
        if (typeof(lastEntry) === typeof(20) && (Date.now() - lastEntry < 30000)) {
            console.log("Don't change because time difference is ",Date.now() - lastEntry)
            return sentences;
        }
        while (typeof(sentences[sentences.length -1 ]) === typeof(20))
        {
            sentences.pop(); // remove timestamp entry for processing
        }
        // Randomize sentences if needed
        if (shouldRandomize) {
            for (let i = 0; i < sentences.length; i++) {
                if (!sentences[i] || !sentences[i].weight) {
                    sentences[i] = await preprocessSentence(sentences[i]);
                }
            }
            // TODO : Add a slider option for alpha value (lower is easier sentences, 0 is fully random, higher is harder sentences)
            function weightedShuffle(items, alpha) {
                console.log("alpha",alpha)
                return items
                    .map((item, i) => {
                        const g = Math.random()*100;
                        return { item, key: alpha * (item.weight || 0) + g };
                    })
                    .sort((a, b) => a.key - b.key)
                    .map(x => x.item);
            }

            sentences = weightedShuffle(sentences.map((s, i) => [s, i]),-10000).map(pair => pair[0]);
        }
        return sentences;
    }

    /**
 * Removes <rt> tags from a DOM element directly.
 * Warning: This modifies the actual DOM element passed in.
 * @param {HTMLElement} element - The DOM element to clean.
 */
    function removeRtFromDOM(element) {
        if (!element) return;

        // Find all <rt> tags within this element
        const rtTags = element.querySelectorAll('rt');

        // Loop through and remove them from the DOM
        rtTags.forEach(tag => tag.remove());
    }

    //MAIN FUNCTIONS=====================================================================================================================
    let onPageLoadRunning = false;
    async function onPageLoad() {
        if (onPageLoadRunning) return;
        onPageLoadRunning = true;
        // Initialize state and determine vocabulary based on URL
        const previousVocab = state.vocab;
        state.embedAboveSubsectionMeanings = false;
        state.isFront = !document.querySelector('.result');
        state.currentlyPlayingAudio = false;
        // Early layout adjustments without waiting
        setPageWidth();
        const sentenceElement = document.querySelector('.sentence');
        if (sentenceElement) {
            // Save the original JPDB HTML so we can restore it when navigating back
            state.jpdbSentenceHtml = sentenceElement.innerHTML;
            const translationEl = document.querySelector('.sentence-translation');
            state.jpdbTranslationText = translationEl ? translationEl.textContent : null;
            removeRtFromDOM(sentenceElement)
            const defaultSentence = sentenceElement.textContent.trim();
            if (defaultSentence) {
                state.jpdbDefaultExample = {textJa: {content: defaultSentence}, isJpdbDefault: true};
            }
            // Show placeholder text while data loads in random mode
            if (CONFIG.RANDOM_SENTENCE) {
                sentenceElement.textContent = 'Waiting for Data...';
                if (translationEl) {
                    translationEl.textContent = '';
                }
            }
        }
        const machineTranslationFrame = document.getElementById('machine-translation-frame');
        // Skip if machine translation frame is present
        if (machineTranslationFrame) {
            return;
        }

        // Determine the vocabulary based on URL — done in parallel with setting page width
        const url = window.location.href;
        console.log(url)
        if (url.includes('/vocabulary/')) {
            [state.vocab, state.reading] = parseVocabFromVocabulary();
        } else if (url.includes('/search?q=')) { // TODO : get reading from search
            state.vocab = parseVocabFromSearch();
        } else if (url.includes('c=')) {
            [state.vocab, state.reading] = parseVocabFromAnswer();
        } else if (url.includes('/kanji/')) {
            state.vocab = parseVocabFromKanji();
        } else if (url.includes('/deck')) {
            const vocabElements = document.querySelectorAll('.vocabulary-spelling');
            if (vocabElements.length > 0) {
                const preprocessBtn = document.createElement('button');
                preprocessBtn.textContent = 'Preprocess All Words';
                preprocessBtn.style.margin = '10px';
                preprocessBtn.addEventListener('click', async () => {
                    preprocessBtn.disabled = true;
                    const tasks = Array.from(vocabElements).map(async (vocabElement) => {
                        const aTag = vocabElement.querySelector('a');
                        const href = aTag?.getAttribute('href') || '';

                        // Split the path into segments
                        const segments = href.split('/');

                        // The word is in the 4th segment (index 3)
                        const lastSegment = segments[3] || '';

                        // Remove the fragment part after # and get reading
                        const rubyElements = aTag.querySelectorAll('ruby');
                        let vocab = '';
                        let reading = '';

                        if (rubyElements.length > 0) {
                            // Build vocab and reading from ruby elements
                            rubyElements.forEach(ruby => {
                                const rt = ruby.querySelector('rt');
                                vocab += ruby.childNodes[0]?.textContent.trim() || '';
                                reading += rt?.textContent.trim() || ruby.textContent.trim();
                            });
                        } else {
                            // No ruby elements, just use the text content
                            vocab = decodeURIComponent(lastSegment.split('#')[0]);
                            reading = vocab;
                        }
                        if (vocab) {
                            try {
                                await getNadeshikoData(vocab, reading);
                            } catch (e) {
                                console.error('Error preprocessing vocab:', vocab, e);
                            }
                        }
                    });
                    await Promise.all(tasks);
                    alert('Preprocessing complete!');
                });
                const entriesAmountTextElem = [...document.querySelectorAll('p')].find(
                    (elem) => elem.innerText.startsWith('Showing') && elem.innerText.endsWith('entries')
                );
                entriesAmountTextElem.parentNode.insertBefore(preprocessBtn, entriesAmountTextElem);
            }
        } else {
            [state.vocab, state.reading] = parseVocabFromReview();
        }

        // Early return if no vocabulary is found
        if (!state.vocab) {
            return;
        }

        // If the vocab changed (new card), reset data state; otherwise keep existing data (e.g., card flip)
        if (state.vocab !== previousVocab) {
            state.currentExampleIndex = 0;
            state.apiDataFetched = false;
            state.examples = state.jpdbDefaultExample ? [state.jpdbDefaultExample] : [];
            state.error = false;
            state.preloadedIndices = new Set();
        }

        // Fetch data if needed, process in parallel threads where possible
        if (!state.apiDataFetched) {
            try {
                await getNadeshikoData(state.vocab);

                // Process sentences in parallel with preloading images
                const processingPromise = process_sentences(state, state.examples);
                const preloadPromise = Promise.resolve().then(() => preloadImages());

                state.examples = await processingPromise;
                // Wait for preloading to complete
                await preloadPromise;

                const db = await IndexedDBManager.open();
                await IndexedDBManager.save(db, state.vocab, state.examples);
                // Finally, display the example
                embedImageAndPlayAudio();
            } catch (error) {
                // Handle errors silently for better performance
                state.error = true;
                embedImageAndPlayAudio(); // Still try to show what we can
            }
        } else if (state.apiDataFetched) {
            // Update display and settings
            await Promise.all([
                Promise.resolve().then(() => embedImageAndPlayAudio()),
                Promise.resolve().then(() => setVocabSize())
            ]);
        }
        onPageLoadRunning = false;
    }

    function setPageWidth() {
        // Set the maximum width of the page
        document.body.style.maxWidth = CONFIG.PAGE_WIDTH;
    }

    // Observe URL changes and reload the page content accordingly
    const observer = new MutationObserver(() => {
        if (window.location.href !== observer.lastUrl) {
            observer.lastUrl = window.location.href;
            onPageLoad();
        }
    });

    // Function to apply styles
    function setVocabSize() {
        // Create a new style element
        const style = document.createElement('style');
        style.type = 'text/css';
        style.textContent = `
	            .answer-box > .plain {
	                font-size: ${CONFIG.VOCAB_SIZE} !important; /* Use the configurable font size */
	                padding-bottom: 0.1rem !important; /* Retain padding */
	            }
	            .card-sentence {
	                justify-content: center;
	            }
	            .sentence {
	                text-align: center;
	            }
	            .sentence-translation {
	                text-wrap: balance;
	                text-align: center;
	            }
	        `;

        // Append the new style to the document head
        document.head.appendChild(style);
    }

    observer.lastUrl = window.location.href;
    observer.observe(document, {subtree: true, childList: true});

    // Add event listeners for page load and URL changes
    window.addEventListener('load', onPageLoad);
    window.addEventListener('popstate', onPageLoad);
    window.addEventListener('hashchange', onPageLoad);

    // Initial configuration and preloading
    loadConfig();
    setPageWidth();
    setVocabSize();
    //preloadImages();

})();
