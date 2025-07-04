// ==UserScript==
// @name         JPDB Nadeshiko Examples
// @version      1.23
// @description  Embeds anime images & audio examples into JPDB review and vocabulary pages using Nadeshiko's API. Compatible only with TamperMonkey.
// @author       awoo& Sacus
// @namespace    jpdb-nadeshiko-examples
// @match        https://jpdb.io/review*
// @match        https://jpdb.io/vocabulary/*
// @match        https://jpdb.io/kanji/*
// @match        https://jpdb.io/search*
// @match        https://jpdb.io/deck*
// @connect      api.brigadasos.xyz
// @connect 	sargus.fr
// @grant        GM_addElement
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/529745/JPDB%20Nadeshiko%20Examples.user.js
// @updateURL https://update.greasyfork.org/scripts/529745/JPDB%20Nadeshiko%20Examples.meta.js
// ==/UserScript==
/*jshint esversion: 11 */
/* global GM_addElement, GM_xmlhttpRequest, GM_setValue, GM_getValue, GM_registerMenuCommand */
(function () {
    'use strict';
    let nadeshikoApiKey = GM_getValue("nadeshiko-api-key", "");
    let jpdbApiKey = GM_getValue("jpdb-api-key", "");
    // Register menu commands
    GM_registerMenuCommand("Set Nadeshiko API Key", async () => {
        nadeshikoApiKey = fetchNadeshikoApiKey();
    });
    GM_registerMenuCommand("Set JPDB API Key", async () => {
        jpdbApiKey = fetchJPDBApiKey();
    });

    function fetchNadeshikoApiKey() {
        let apiKey = prompt("A Nadeshiko API key is required for this extension to work.\n\nYou can get one for free here after creating an account: https://nadeshiko.co/settings/developer");
        GM_setValue("nadeshiko-api-key", apiKey);

        if (apiKey) {
            alert("API Key saved successfully!");
        }

        return apiKey;
    }

    function fetchJPDBApiKey() {
        let apiKey = prompt("A JPDB API key is required for this extension to work.\n\nYou can get it in the settings page of your JPDB account.");
        GM_setValue("jpdb-api-key", apiKey);

        if (apiKey) {
            // send ping at https://jpdb.io/api/v1/ping to check if the key is valid
            GM_xmlhttpRequest({
                method: "POST",
                url: "https://jpdb.io/api/v1/ping",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                },
                onload: function (response) {
                    if (response.status === 200) {
                        alert("API Key saved successfully!");
                    } else {
                        alert("Invalid API Key. Please check your key and try again.");
                    }
                },
                onerror: function (error) {
                    alert("An error occurred while checking the API Key. Please try again.");
                }
            });
        }
        return apiKey;
    }

    // to use custom hotkeys just add them into this array following the same format. Any single keys except space
    // should work. If you want to use special keys, check the linked page for how to represent them in the array
    // (link leads to the arrow keys part so you can compare with the array and be sure which part to write):
    // https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values#navigation_keys
    const hotkeyOptions = ['None', 'ArrowLeft ArrowRight', ', .', '[ ]', 'Q W'];

    const RANDOM_SENTENCE_ENUM = {
        DISABLE: 0,
        ON_FIRST: 1,
        EVERY_TIME: 2
    };
    const CONFIG = {
        IMAGE_WIDTH: '400px',
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
        HOTKEYS: ['None'],
        DEFAULT_TO_EXACT_SEARCH: true,
        // On changing this config option, the icons change but the sentences don't, so you
        // have to click once to match up the icons and again to actually change the sentences
        RANDOM_SENTENCE: RANDOM_SENTENCE_ENUM,
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
        exactSearch: true,
        error: false,
        currentlyPlayingAudio: false,
        reading: '',
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
    const removeItem = (key) => {
        localStorage.removeItem(scriptPrefix + key);
        localStorage.removeItem(key);
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
                        } else if (validationError) {
                            console.log(`Deleting entry for keyword "${keyword}" due to validation error: ${validationError}`);
                            await this.deleteEntry(db, keyword);
                            resolve(null);
                        } else {
                            resolve(result.data);
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
                        console.log(`Invalid data detected: ${validationError}. Not saving to IndexedDB.`);
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
    function getNadeshikoData(vocab, exactSearch) {


        return new Promise(async (resolve, reject) => {
            const searchVocab = exactSearch ? `"${vocab}"` : vocab;
            const url = `https://api.brigadasos.xyz/api/v1/search/media/sentence`;
            const maxRetries = 5;
            let attempt = 0;

            const storedValue = getItem(state.vocab);
            const isBlacklisted = storedValue && storedValue.split(',').length > 1 && parseInt(storedValue.split(',')[1], 10) === 2;

            // Return early if not blacklisted
            if (isBlacklisted) {
                resolve();
                return;
            }

            async function fetchData() {
                try {
                    const db = await IndexedDBManager.open();
                    const cachedData = await IndexedDBManager.get(db, searchVocab);
                    if (cachedData && Array.isArray(cachedData) && cachedData.length > 0) {
                        console.log('Data retrieved from IndexedDB');
                        state.examples = cachedData;
                        state.apiDataFetched = true;
                        resolve();
                    } else {
                        console.log(`Calling API for: ${searchVocab}`);
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
                            data: JSON.stringify({
                                query: searchVocab,
                                "limit": 500,
                                "min_length": CONFIG.MINIMUM_EXAMPLE_LENGTH,
                                "max_length": CONFIG.MAXIMUM_EXAMPLE_LENGTH
                            }),
                            headers:
                                {
                                    "X-API-Key": nadeshikoApiKey,
                                    "Content-Type": "application/json"
                                },
                            onload: async function (response) {
                                console.log(state)
                                async function validateAndUpdateExamples(jsonState) {
                                    try {
                                        const sargusData = {
                                            word: state?.vocab ?? '',
                                            reading: state?.reading ?? '',          // optional reading
                                            sentences: (jsonState ?? [])                        // guarantee an array
                                                .map(e => e?.segment_info?.content_jp)                  // optional-chain every step
                                                .filter(Boolean)                                        // keep only truthy strings
                                        };

                                        const names = await checkIfNames(sargusData);               // may throw/reject
                                        if (!Array.isArray(names)) {
                                            throw new TypeError('checkIfNames did not return an array.');
                                        }
                                        if (names.length !== jsonState.length) {
                                            throw new RangeError(
                                                `Mismatch: received ${names.length} flags for ${jsonState.length} examples.`
                                            );
                                        }

                                        jsonState = jsonState.filter((_, i) => !names[i]);
                                        return jsonState; // return filtered examples
                                    } catch (err) {
                                        console.error('Failed to filter examples:', err);
                                        // Decide how to handle the error: show a message, re-throw, etc.
                                    }
                                }

                                if (response.status === 200) {
                                    let jsonData = parseJSON(response.response).sentences;
                                    console.log("API JSON Received");
                                    const validationError = validateApiResponse(jsonData);
                                    if (!validationError) {
                                        state.apiDataFetched = true;
                                        // check if the sentence is in the vocab
                                        jsonData = await validateAndUpdateExamples(jsonData)
                                        const sentenceResults = await Promise.all(
                                            jsonData.map(async sentence => {
                                                return await preprocessSentence(sentence);
                                            }))
                                        jsonData = sentenceResults.filter(s => s);
                                        state.examples = jsonData;
                                        await IndexedDBManager.save(db, searchVocab, jsonData);
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

        return null; // No error
    }

    async function checkIfNames(sargusData) {
        return await new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: "http://sargus.fr:8000/api/check_names",
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

    async function preprocessSentence(sentence) {
        const content = sentence.segment_info.content_jp;
        // Set weights for each sentence by calling jpdb api (if needed)
        if (CONFIG.WEIGHTED_SENTENCES && jpdbApiKey) {
            const jipidata = {
                text: content,
                token_fields: [],
                position_length_encoding: "utf16",
                vocabulary_fields: ["card_state", "spelling", "reading"]
            };
            let vocabInSentence = false;
            await processJPDBData(sentence, jipidata);

            async function processJPDBData(sentence, jipidata) {
                return await new Promise((resolve) => {
                    GM_xmlhttpRequest({
                        method: "POST",
                        url: "https://jpdb.io/api/v1/parse",
                        headers: {Authorization: `Bearer ${jpdbApiKey}`},
                        data: JSON.stringify(jipidata),
                        onload: function (response) {
                            let weight = 1;
                            if (response.status === 200) {
                                try {
                                    const vocab = JSON.parse(response.responseText).vocabulary || [];
                                    if (vocab.length > 0) {
                                        const VALID_CARD_STATES = ["known", "never-forget", "learning"];
                                        let matchCount = 0;
                                        for (const item of vocab) {
                                            if (!state.reading){
                                                vocabInSentence = true;
                                            }
                                            else if (item && item[1] && item[2] && item[1].includes(state.vocab) && item[2].includes(state.reading)) {
                                                vocabInSentence = true;
                                            }
                                            if (item && item[0] && VALID_CARD_STATES.includes(item[0][0])) {
                                                matchCount++;
                                            }
                                        }
                                        weight = (matchCount * 100 / (vocab.length));
                                    }
                                } catch {
                                    console.error("Error parsing parse response");
                                }
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
                console.log(`Skipping sentence "${content}" because it does not contain the vocab "${state.vocab}" or reading "${state.reading}".`);
                return null;
            }
        }

        return sentence;
    }

    //FAVORITE DATA FUNCTIONS=====================================================================================================================
    function getStoredData(key) {
        // Retrieve the stored value from localStorage using the provided key
        const storedValue = getItem(key);

        // If a stored value exists, split it into index and exactState
        if (storedValue) {
            const [index, exactState] = storedValue.split(',');
            return {
                index: parseInt(index, 10), // Convert index to an integer
                exactState: exactState === '1' // Convert exactState to a boolean
            };
        }

        // Return default values if no stored value exists
        return {index: 0, exactState: state.exactSearch};
    }

    function storeData(key, sentence, exactState) {
        // Create a string value from index and exactState to store in localStorage
        const value = `${sentence},${exactState ? 1 : 0}`;

        // Store the value in localStorage using the provided key
        setItem(key, value);
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

    function createStarButton() {
        // Create a star button with an icon and click event for toggling favorite state
        const anchor = createAnchor('0.5rem');
        const starIcon = document.createElement('span');
        const storedValue = getItem(state.vocab);
        // console.log(storedValue);

        // Determine the star icon (filled or empty) based on stored value
        if (storedValue) {
            const [storedIndex, storedExactState] = storedValue.split(',');
            const index = parseInt(storedIndex, 10);
            const exactState = Boolean(parseInt(storedExactState, 10));
            starIcon.textContent = (state.currentExampleIndex === index && state.exactSearch === exactState) ? '★' : '☆';
        } else {
            starIcon.textContent = '☆';
        }


        // Style the star icon
        starIcon.style.fontSize = '1.4rem';
        starIcon.style.color = '#3D8DFF';
        starIcon.style.verticalAlign = 'middle';
        starIcon.style.position = 'relative';
        starIcon.style.top = '-2px';

        // Append the star icon to the anchor and set up the click event to toggle star state
        anchor.appendChild(starIcon);
        anchor.addEventListener('click', (event) => {
            event.preventDefault();
            toggleStarState(starIcon);
        });

        return anchor;
    }

    function toggleStarState(starIcon) {
        const storedValue = getItem(state.vocab);
        const isBlacklisted = storedValue && storedValue.split(',').length > 1 && parseInt(storedValue.split(',')[1], 10) === 2;

        // Return early if blacklisted
        if (isBlacklisted) {
            starIcon.textContent = '☆';
            return;
        }

        // Toggle the star state between filled and empty
        if (storedValue) {
            const [storedIndex, storedExactState] = storedValue.split(',');
            const index = parseInt(storedIndex, 10);
            const exactState = storedExactState === '1';
            if (index === state.currentExampleIndex && exactState === state.exactSearch) {
                removeItem(state.vocab);
                starIcon.textContent = '☆';
            } else {
                setItem(state.vocab, `${state.currentExampleIndex},${state.exactSearch ? 1 : 0}`);
                starIcon.textContent = '★';
            }
        } else {
            setItem(state.vocab, `${state.currentExampleIndex},${state.exactSearch ? 1 : 0}`);
            starIcon.textContent = '★';
        }
    }

    function createQuoteButton() {
        // Create a quote button with an icon and click event for toggling quote style
        const anchor = createAnchor('0rem');
        const quoteIcon = document.createElement('span');

        // Set the icon based on exact search state
        quoteIcon.innerHTML = state.exactSearch ? '<b>「」</b>' : '『』';

        // Style the quote icon
        quoteIcon.style.fontSize = '1.1rem';
        quoteIcon.style.color = '#3D8DFF';
        quoteIcon.style.verticalAlign = 'middle';
        quoteIcon.style.position = 'relative';
        quoteIcon.style.top = '0px';

        // Append the quote icon to the anchor and set up the click event to toggle quote state
        anchor.appendChild(quoteIcon);
        anchor.addEventListener('click', (event) => {
            event.preventDefault();
            toggleQuoteState(quoteIcon);
        });

        return anchor;
    }

    function toggleQuoteState(quoteIcon) {
        const storedValue = getItem(state.vocab);
        const isBlacklisted = storedValue && storedValue.split(',').length > 1 && parseInt(storedValue.split(',')[1], 10) === 2;

        // Return early if blacklisted
        if (isBlacklisted) {
            return;
        }

        // Toggle between single and double quote styles
        state.exactSearch = !state.exactSearch;
        quoteIcon.innerHTML = state.exactSearch ? '<b>「」</b>' : '『』';

        // Update state based on stored data
        const storedData = getStoredData(state.vocab);
        if (storedData && storedData.exactState === state.exactSearch) {
            state.currentExampleIndex = storedData.index;
        } else {
            state.currentExampleIndex = 0;
        }

        state.apiDataFetched = false;
        embedImageAndPlayAudio();
        getNadeshikoData(state.vocab, state.exactSearch)
            .then(() => {
                embedImageAndPlayAudio();
            })
            .catch(error => {
                console.error(error);
            });
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

    function createTextButton(vocab, exact) {
        // Create a text button for Nadeshiko
        const textButton = document.createElement('a');
        textButton.textContent = 'Nadeshiko';
        textButton.style.color = 'var(--subsection-label-color)';
        textButton.style.fontSize = '85%';
        textButton.style.marginRight = '0.5rem';
        textButton.style.verticalAlign = 'middle';
        textButton.href = `https://nadeshiko.co/search/sentence?query=${encodeURIComponent(vocab)}`;
        textButton.target = '_blank';
        return textButton;
    }

    function createButtonContainer(soundUrl, vocab, exact) {
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
        const textButton = createTextButton(vocab, exact);
        const speakerButton = createSpeakerButton(soundUrl);
        const starButton = createStarButton();
        const quoteButton = createQuoteButton();

        // Center the buttons within the container
        const centeredButtonsWrapper = document.createElement('div');
        centeredButtonsWrapper.style.display = 'flex';
        centeredButtonsWrapper.style.justifyContent = 'center';
        centeredButtonsWrapper.style.flex = '1';

        centeredButtonsWrapper.append(textButton, speakerButton, starButton, quoteButton);
        buttonContainer.append(centeredButtonsWrapper, menuButton);

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
        // Skip playing audio if it is already playing
        if (state.currentlyPlayingAudio) {
            //console.log('Duplicate audio was skipped.');
            return;
        }

        if (soundUrl) {
            state.currentlyPlayingAudio = true;
            stopCurrentAudio();

            GM_xmlhttpRequest({
                method: 'GET',
                url: soundUrl,
                responseType: 'arraybuffer',
                onload: function (response) {
                    const AudioContext = window.AudioContext || window.webkitAudioContext;
                    const audioContext = new AudioContext();
                    audioContext.decodeAudioData(response.response, function (buffer) {
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

                        // Log when the audio starts playing
                        //console.log('Audio has started playing.');

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

    function renderImageAndPlayAudio(vocab, shouldAutoPlaySound) {
        if (state.apiDataFetched === false) {
            console.log("No data");
            return;
        }
        const example = state.examples[state.currentExampleIndex] || {};
        const imageUrl = example.media_info?.path_image || null;
        const soundUrl = example.media_info?.path_audio || null;
        const sentence = example.segment_info?.content_jp || null;
        const translation = example.segment_info?.content_en || "";
        const deck_name = example.basic_info?.name_anime_romaji || "Unknown Anime";
        const storedValue = getItem(state.vocab);
        const isBlacklisted = storedValue && storedValue.split(',').length > 1 && parseInt(storedValue.split(',')[1], 10) === 2;
        // Update sentence class content with actual sentence text
        const sentenceElement = document.querySelector('.sentence');
        if (sentenceElement) {
            sentenceElement.textContent = sentence;
            // Update translation class content with actual translation text
            const translationElement = document.querySelector('.sentence-translation');
            if (translationElement) {
                translationElement.textContent = translation;
            } else {
                // get div above .card-sentence
                const divAbove = sentenceElement.parentElement.previousElementSibling;
                if (divAbove) {
                    const translationDiv = document.createElement('div');
                    translationDiv.style.display = 'flex';
                    translationDiv.style.justifyContent = 'center';
                    translationDiv.innerHTML = `<div class="sentence-translation blur" style="" onclick="this.classList.remove('blur');" onmouseover="this.classList.remove('blur');">${translation}</div>`;
                    divAbove.appendChild(translationDiv);
                }
            }
        } else {
            const answerBox = document.querySelector('.answer-box');
            if (answerBox) {
                // create div style="display: flex; justify-content: center;"
                const sentenceDiv = document.createElement('div');
                sentenceDiv.style.display = 'flex';
                sentenceDiv.style.justifyContent = 'center';
                sentenceDiv.innerHTML = `<div style="display: flex;"><div style="display: flex; flex-direction: column;"><div style="display: flex; align-items: baseline; column-gap: 0.25rem;" class="card-sentence"><div class="sentence" style="margin-left: 0.3rem;">${sentence}</div><a class="icon-link" href="/edit-shown-sentence?v=1168870&amp;s=3448502455&amp;r=1858493110&amp;origin=%2Freview%3Fc%3Dvf%2C1168870%2C3448502455%26r%3D2"><i class="ti ti-pencil"></i></a></div><div style="display: flex;justify-content: center;"><div class="sentence-translation blur" style="" onclick="this.classList.remove('blur');" onmouseover="this.classList.remove('blur');">${translation}</div></div></div></div>`;
                answerBox.appendChild(sentenceDiv);

            }
        }

        // Remove any existing container
        removeExistingContainer();
        if (!shouldRenderContainer()) {
            return;
        }

        // Create and append the main wrapper and text button container
        const wrapperDiv = createWrapperDiv();
        const textDiv = createButtonContainer(soundUrl, vocab, state.exactSearch);
        wrapperDiv.appendChild(textDiv);


        const createTextElement = (text) => {
            const textElement = document.createElement('div');
            textElement.textContent = text;
            textElement.style.padding = '100px 0';
            textElement.style.whiteSpace = 'pre'; // Ensures newlines are respected
            return textElement;
        };

        if (isBlacklisted) {
            wrapperDiv.appendChild(createTextElement('BLACKLISTED'));
            shouldAutoPlaySound = false;
        } else if (state.apiDataFetched) {
            if (imageUrl) {
                const imageElement = createImageElement(wrapperDiv, imageUrl, vocab, state.exactSearch);
                if (imageElement) {
                    imageElement.addEventListener('click', () => playAudio(soundUrl));
                }
            } else {
                wrapperDiv.appendChild(createTextElement(`NO IMAGE\n(${deck_name})`));
            }
            // Append sentence and translation or a placeholder text
            // sentence ? appendSentenceAndTranslation(wrapperDiv, sentence, translation) : appendNoneText(wrapperDiv);
        } else if (!sentence) {
            wrapperDiv.appendChild(createTextElement('ERROR\nNO EXAMPLES FOUND\n\nRARE WORD OR NADESHIKO API IS TEMPORARILY DOWN'));
        } else {
            wrapperDiv.appendChild(createTextElement('LOADING'));
        }


        // Create navigation elements
        const navigationDiv = createNavigationDiv();
        const leftArrow = createLeftArrow(vocab, shouldAutoPlaySound);
        const rightArrow = createRightArrow(vocab, shouldAutoPlaySound);

        // Create and append the main container
        const containerDiv = createContainerDiv(leftArrow, wrapperDiv, rightArrow, navigationDiv);
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

    function createImageElement(wrapperDiv, imageUrl, vocab, exactSearch) {
        // Create and return an image element with specified attributes
        const searchVocab = exactSearch ? `「${vocab}」` : vocab;
        const example = state.examples[state.currentExampleIndex] || {};
        const deck_name = example.basic_info.name_anime_romaji || null;

        // Extract the file name from the URL
        let file_name = imageUrl.substring(imageUrl.lastIndexOf('/') + 1);

        // Remove prefixes "Anime_", "A_", or "Z" from the file name
        file_name = file_name.replace(/^(Anime_|A_|Z)/, '');

        const titleText = `${searchVocab} #${state.currentExampleIndex + 1} \n${deck_name} \n${file_name}`;

        return GM_addElement(wrapperDiv, 'img', {
            src: imageUrl,
            alt: 'Embedded Image',
            title: titleText,
            style: `max-width: ${CONFIG.IMAGE_WIDTH}; margin-top: 10px; cursor: pointer;`
        });
    }

    function highlightVocab(sentence, vocab) {
        // Highlight vocabulary in the sentence based on configuration
        if (!CONFIG.COLORED_SENTENCE_TEXT) {
            return sentence;
        }

        if (state.exactSearch) {
            const regex = new RegExp(`(${vocab})`, 'g');
            return sentence.replace(regex, '<span style="color: var(--outline-input-color);">$1</span>');
        } else {
            return vocab.split('').reduce((acc, char) => {
                const regex = new RegExp(char, 'g');
                return acc.replace(regex, `<span style="color: var(--outline-input-color);">${char}</span>`);
            }, sentence);
        }
    }

    function appendSentenceAndTranslation(wrapperDiv, sentence, translation) {
        // Append sentence and translation to the wrapper div
        const sentenceText = document.createElement('div');
        sentenceText.innerHTML = highlightVocab(sentence, state.vocab);
        sentenceText.style.marginTop = '10px';
        sentenceText.style.fontSize = CONFIG.SENTENCE_FONT_SIZE;
        sentenceText.style.color = 'lightgray';
        sentenceText.style.maxWidth = CONFIG.IMAGE_WIDTH;
        sentenceText.style.whiteSpace = 'pre-wrap';
        wrapperDiv.appendChild(sentenceText);

        if (CONFIG.ENABLE_EXAMPLE_TRANSLATION && translation) {
            const translationText = document.createElement('div');
            translationText.innerHTML = replaceSpecialCharacters(translation);
            translationText.style.marginTop = '5px';
            translationText.style.fontSize = CONFIG.TRANSLATION_FONT_SIZE;
            translationText.style.color = 'var(--subsection-label-color)';
            translationText.style.maxWidth = CONFIG.IMAGE_WIDTH;
            translationText.style.whiteSpace = 'pre-wrap';
            wrapperDiv.appendChild(translationText);
        }
    }

    function appendNoneText(wrapperDiv) {
        // Append a "None" text to the wrapper div
        const noneText = document.createElement('div');
        noneText.textContent = 'None';
        noneText.style.marginTop = '10px';
        noneText.style.fontSize = '85%';
        noneText.style.color = 'var(--subsection-label-color)';
        wrapperDiv.appendChild(noneText);
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
                state.currentlyPlayingAudio = false;
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
                state.currentlyPlayingAudio = false;
                renderImageAndPlayAudio(vocab, shouldAutoPlaySound);
                preloadImages();
            }
        });
        return rightArrow;
    }

    function createContainerDiv(leftArrow, wrapperDiv, rightArrow, navigationDiv) {
        // Create and configure the main container div
        const containerDiv = document.createElement('div');
        containerDiv.id = 'nadeshiko-container';
        containerDiv.style.display = 'flex';
        containerDiv.style.alignItems = 'center';
        containerDiv.style.justifyContent = 'center';
        containerDiv.style.flexDirection = 'column';

        const arrowWrapperDiv = document.createElement('div');
        arrowWrapperDiv.style.display = 'flex';
        arrowWrapperDiv.style.alignItems = 'center';
        arrowWrapperDiv.style.justifyContent = 'center';

        arrowWrapperDiv.append(leftArrow, wrapperDiv, rightArrow);
        containerDiv.append(arrowWrapperDiv, navigationDiv);

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

    function replaceSpecialCharacters(text) {
        // Replace special characters in the text
        return text.replace(/<br>/g, '\n').replace(/&quot;/g, '"').replace(/\n/g, '<br>');
    }

    function preloadImages() {
        // Preload images around the current example index
        const preloadDiv = GM_addElement(document.body, 'div', {style: 'display: none;'});
        const startIndex = Math.max(0, state.currentExampleIndex - CONFIG.NUMBER_OF_PRELOADS);
        const endIndex = Math.min(state.examples.length - 1, state.currentExampleIndex + CONFIG.NUMBER_OF_PRELOADS);

        for (let i = startIndex; i <= endIndex; i++) {
            if (!state.preloadedIndices.has(i) && state.examples[i].image_url) {
                GM_addElement(preloadDiv, 'img', {src: state.examples[i].image_url});
                state.preloadedIndices.add(i);
            }
        }
    }


    //MENU FUNCTIONS=====================================================================================================================
    ////FILE OPERATIONS=====================================================================================================================
    function handleImportButtonClick() {
        handleFileInput('application/json', importFavorites);
    }

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

    function addBlacklist() {
        setItem(state.vocab, `0,2`);
        location.reload();
    }

    function remBlacklist() {
        removeItem(state.vocab);
        location.reload();
    }

    function exportFavorites() {
        const favorites = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith(scriptPrefix)) {
                const keyPrefixless = key.substring(scriptPrefix.length); // chop off the script prefix
                if (!keyPrefixless.startsWith(configPrefix)) {
                    favorites[keyPrefixless] = localStorage.getItem(key);
                    // For backwards compatibility keep the exported keys prefixless
                }
            }
        }
        const data = JSON.stringify(favorites, null, 2);
        createBlobAndDownload(data, 'favorites.json', 'application/json');
    }

    function importFavorites(event) {
        const file = event.target.files[0];
        if (!file) {
            return;
        }

        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const favorites = JSON.parse(e.target.result);
                for (const key in favorites) {
                    setItem(key, favorites[key]);
                }
                alert('Favorites imported successfully!');
                location.reload();
            } catch (error) {
                alert('Error importing favorites:', error);
            }
        };
        reader.readAsText(file);
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
        const blacklistContainer = createBlacklistContainer();
        const favoritesContainer = createFavoritesContainer();
        const dataContainer = createDataContainer();
        const actionButtonsContainer = createActionButtonsContainer();

        const buttonContainer = document.createElement('div');
        buttonContainer.append(blacklistContainer, favoritesContainer, dataContainer, actionButtonsContainer);

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

    ////BLACKLIST BUTTONS
    function createBlacklistContainer() {
        const blacklistButtonWidth = '200px';

        const addBlacklistButton = createButton('Add to Blacklist', '10px', addBlacklist, blacklistButtonWidth);
        const remBlacklistButton = createButton('Remove from Blacklist', '10px', remBlacklist, blacklistButtonWidth);

        const blacklistContainer = document.createElement('div');
        blacklistContainer.style.textAlign = 'center';
        blacklistContainer.style.marginTop = '10px';
        blacklistContainer.append(addBlacklistButton, remBlacklistButton);

        return blacklistContainer;
    }

    ////FAVORITE BUTTONS
    function createFavoritesContainer() {
        const favoritesButtonWidth = '200px';

        const exportButton = createButton('Export Favorites', '10px', exportFavorites, favoritesButtonWidth);
        const importButton = createButton('Import Favorites', '10px', handleImportButtonClick, favoritesButtonWidth);

        const favoritesContainer = document.createElement('div');
        favoritesContainer.style.textAlign = 'center';
        favoritesContainer.style.marginTop = '10px';
        favoritesContainer.append(exportButton, importButton);

        return favoritesContainer;

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
            'Changing Minimum Example Length will break your current favorites. They will all be deleted. Are you sure?',
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
                'This will delete all your favorites and cached data. Are you sure?',
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

            if (key === 'RANDOM_SENTENCE') {
                const select = document.createElement('select');
                select.setAttribute('data-key', key);

                // Add options to the select dropdown for the enum values
                for (const [enumKey, enumValue] of Object.entries(RANDOM_SENTENCE_ENUM)) {
                    const option = document.createElement('option');
                    option.value = enumValue;
                    option.text = enumKey.replace(/_/g, ' ').toLowerCase();
                    option.selected = value === enumValue; // Set the current value as selected
                    select.appendChild(option);
                }

                select.addEventListener('change', (event) => {
                    CONFIG[key] = parseInt(event.target.value, 10); // Update the config with the selected value
                    localStorage.setItem(`${scriptPrefix + configPrefix}${key}`, event.target.value); // Save to localStorage
                });

                rightContainer.appendChild(select);
            } else if (typeof value === 'boolean') {
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
            if (configKey === 'RANDOM_SENTENCE') {
                if (savedValue == 0) {
                    CONFIG[configKey] = RANDOM_SENTENCE_ENUM.DISABLE;
                }
                if (savedValue == 1) {
                    CONFIG[configKey] = RANDOM_SENTENCE_ENUM.ON_FIRST;
                }
                if (savedValue == 2) {
                    CONFIG[configKey] = RANDOM_SENTENCE_ENUM.EVERY_TIME;
                }
            } else if (configKey === 'HOTKEYS') {
                CONFIG[configKey] = savedValue.split(' ');
            } else if (valueType === 'boolean') {
                CONFIG[configKey] = savedValue === 'true';
                if (configKey === 'DEFAULT_TO_EXACT_SEARCH') {
                    state.exactSearch = CONFIG.DEFAULT_TO_EXACT_SEARCH;
                }
                // I wonder if this is the best way to do this...
                // Probably not because we could just have a single variable to store both, but it would have to be in config and
                // it would be a bit weird to have the program modifying config when the actual config settings aren't changing
            } else if (valueType === 'number') {
                CONFIG[configKey] = parseFloat(savedValue);
            } else if (valueType === 'string') {
                CONFIG[configKey] = savedValue;
            }
        }
    }


    async function process_sentences(state, sentences, first_call) {
        // Early return for empty array or single item (no processing needed)
        if (!sentences || !Array.isArray(sentences) || sentences.length <= 1) {
            return sentences;
        }
        // Only randomize if needed
        const shouldRandomize = CONFIG.RANDOM_SENTENCE >
            (first_call ? RANDOM_SENTENCE_ENUM.DISABLE : RANDOM_SENTENCE_ENUM.ON_FIRST);

        // Skip weight calculation if not needed
        if (!CONFIG.WEIGHTED_SENTENCES && !shouldRandomize) {
            return sentences;
        }

        // Randomize sentences if needed
        if (shouldRandomize) {
            // Use Fisher-Yates shuffle for better performance
            // Only shuffle a maximum of 50 items for large arrays to improve performance
            const maxShuffleItems = Math.min(sentences.length, 50);

            // Optimized weighted random algorithm
            const getWeightedRandomIndex = async (max) => {
                // Pre-calculate weights array for performance
                const weights = new Array(max);
                let totalWeight = 0;
                for (let i = 0; i < max; i++) {
                    if (!sentences[i] || !sentences[i].weight) {
                        await preprocessSentence(sentences[i]);
                    }
                    const weight = (sentences[i].weight || 1);
                    weights[i] = weight;
                    totalWeight += weight;
                }

                // Get random value proportional to total weight
                const random = Math.random() * totalWeight;
                let cumulativeWeight = 0;

                // Find the index
                for (let i = 0; i < max; i++) {
                    cumulativeWeight += weights[i];
                    if (random <= cumulativeWeight) {
                        return i;
                    }
                }

                return max - 1; // Fallback
            };

            // Fisher-Yates shuffle with weighted randomization
            for (let i = maxShuffleItems - 1; i > 0; i--) {
                console.log(maxShuffleItems - i, "/", maxShuffleItems)
                const j = CONFIG.WEIGHTED_SENTENCES ?
                    await getWeightedRandomIndex(i + 1) :
                    Math.floor(Math.random() * (i + 1));

                // Swap elements
                if (i !== j) {
                    [sentences[i], sentences[j]] = [sentences[j], sentences[i]];
                }
            }
        }

        return sentences;
    }

    //MAIN FUNCTIONS=====================================================================================================================
    async function onPageLoad() {
        // Initialize state and determine vocabulary based on URL
        state.embedAboveSubsectionMeanings = false;

        // Early layout adjustments without waiting
        setPageWidth();
        const sentenceElement = document.querySelector('.sentence');
        if (sentenceElement) {
            sentenceElement.textContent = "Waiting for data...";
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
                    for (const vocabElement of vocabElements) {
                        const aTag = vocabElement.querySelector('a');
                        const href = aTag.getAttribute('href');

                        // Split the path into segments
                        const segments = href.split('/');

                        // The word is in the 4th segment (index 3)
                        const lastSegment = segments[3] || '';

                        // Remove the fragment part after #
                        const vocab = decodeURIComponent(lastSegment.split('#')[0]);
                        console.log(vocab)
                        if (vocab) {
                            await getNadeshikoData(vocab, state.exactSearch);
                        }
                    }
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

        // Retrieve stored data for the current vocabulary
        const {sentence, exactState} = getStoredData(state.vocab);
        state.exactSearch = exactState;

        // Fetch data if needed, process in parallel threads where possible
        if (!state.apiDataFetched) {
            try {
                await getNadeshikoData(state.vocab, state.exactSearch);

                // Process sentences in parallel with preloading images
                const processingPromise = process_sentences(state, state.examples, true);
                const preloadPromise = Promise.resolve().then(() => preloadImages());

                state.examples = await processingPromise;

                // Set current example index if a sentence exists
                if (sentence) {
                    state.currentExampleIndex = state.examples.findIndex(
                        example => example.segment_info.content_jp === sentence
                    );
                }

                // Wait for preloading to complete
                await preloadPromise;

                // Finally, display the example
                embedImageAndPlayAudio();
            } catch (error) {
                // Handle errors silently for better performance
                state.error = true;
                embedImageAndPlayAudio(); // Still try to show what we can
            }
        } else if (state.apiDataFetched) {
            // Data already fetched, just update display
            if (sentence) {
                // Process sentence index finding without logging
                state.currentExampleIndex = await process_sentences(
                    state,
                    state.examples.findIndex(example => example.segment_info.content_jp === sentence),
                    false
                );
            }

            // Update display and settings
            Promise.all([
                Promise.resolve().then(() => embedImageAndPlayAudio()),
                Promise.resolve().then(() => setVocabSize())
            ]);
        }
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
        style.innerHTML = `
	            .answer-box > .plain {
	                font-size: ${CONFIG.VOCAB_SIZE} !important; /* Use the configurable font size */
	                padding-bottom: 0.1rem !important; /* Retain padding */
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
