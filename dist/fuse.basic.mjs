/**
 * Fuse.js v7.6.0-beta.0 - Lightweight fuzzy-search (http://fusejs.io)
 *
 * Copyright (c) 2026 Kiro Risk (http://kiro.me)
 * All Rights Reserved. Apache Software License 2.0
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */
//#region src/helpers/typeGuards.ts
function isArray(value) {
	return !Array.isArray ? getTag(value) === "[object Array]" : Array.isArray(value);
}
function baseToString(value) {
	if (typeof value == "string") return value;
	if (typeof value === "bigint") return value.toString();
	const result = value + "";
	return result == "0" && 1 / value == -Infinity ? "-0" : result;
}
function toString(value) {
	return value == null ? "" : baseToString(value);
}
function isString(value) {
	return typeof value === "string";
}
function isNumber(value) {
	return typeof value === "number";
}
function isBoolean(value) {
	return value === true || value === false || isObjectLike(value) && getTag(value) == "[object Boolean]";
}
function isObject(value) {
	return typeof value === "object";
}
function isObjectLike(value) {
	return isObject(value) && value !== null;
}
function isDefined(value) {
	return value !== void 0 && value !== null;
}
function isBlank(value) {
	return !value.trim().length;
}
function getTag(value) {
	return value == null ? value === void 0 ? "[object Undefined]" : "[object Null]" : Object.prototype.toString.call(value);
}

//#endregion
//#region src/core/errorMessages.ts
const EXTENDED_SEARCH_UNAVAILABLE = "Extended search is not available";
const LOGICAL_SEARCH_UNAVAILABLE = "Logical search is not available";
const TOKEN_SEARCH_UNAVAILABLE = "Token search is not available";
const INCORRECT_INDEX_TYPE = "Incorrect 'index' type";
const INVALID_DOC_INDEX = "Invalid doc index: must be a non-negative integer within the bounds of the docs array";
const LOGICAL_SEARCH_INVALID_QUERY_FOR_KEY = (key) => `Invalid value for key ${key}`;
const OBJECT_QUERY_UNAVAILABLE = "Object query syntax is not available in this build";
const MISSING_KEY_PROPERTY = (name) => `Missing ${name} property in key`;
const INVALID_KEY_WEIGHT_VALUE = (key) => `Property 'weight' in key '${key}' must be a positive integer`;
const FUSE_MATCH_TOKEN_SEARCH_UNSUPPORTED = "Fuse.match does not support useTokenSearch: token search requires corpus-level statistics (df, fieldCount) that a one-off string comparison does not have. Use new Fuse(...).search(...) instead.";

//#endregion
//#region src/tools/KeyStore.ts
const hasOwn = Object.prototype.hasOwnProperty;
var KeyStore = class {
	constructor(keys) {
		this._keys = [];
		this._keyMap = {};
		let totalWeight = 0;
		keys.forEach((key) => {
			const obj = createKey(key);
			this._keys.push(obj);
			this._keyMap[obj.id] = obj;
			totalWeight += obj.weight;
		});
		this._keys.forEach((key) => {
			key.weight /= totalWeight;
		});
	}
	get(keyId) {
		return this._keyMap[keyId];
	}
	keys() {
		return this._keys;
	}
	toJSON() {
		return JSON.stringify(this._keys);
	}
};
function createKey(key) {
	let path = null;
	let id = null;
	let src = null;
	let weight = 1;
	let getFn = null;
	if (isString(key) || isArray(key)) {
		src = key;
		path = createKeyPath(key);
		id = createKeyId(key);
	} else {
		if (!hasOwn.call(key, "name")) throw new Error(MISSING_KEY_PROPERTY("name"));
		const name = key.name;
		src = name;
		if (hasOwn.call(key, "weight") && key.weight !== void 0) {
			weight = key.weight;
			if (weight <= 0) throw new Error(INVALID_KEY_WEIGHT_VALUE(createKeyId(name)));
		}
		path = createKeyPath(name);
		id = createKeyId(name);
		getFn = key.getFn ?? null;
	}
	return {
		path,
		id,
		weight,
		src,
		getFn
	};
}
function createKeyPath(key) {
	return isArray(key) ? key : key.split(".");
}
function createKeyId(key) {
	return isArray(key) ? key.join(".") : key;
}

//#endregion
//#region src/helpers/get.ts
function get(obj, path) {
	const list = [];
	let arr = false;
	const deepGet = (obj, path, index, arrayIndex) => {
		if (!isDefined(obj)) return;
		if (!path[index]) list.push(arrayIndex !== void 0 ? {
			v: obj,
			i: arrayIndex
		} : obj);
		else {
			const value = obj[path[index]];
			if (!isDefined(value)) return;
			if (index === path.length - 1 && (isString(value) || isNumber(value) || isBoolean(value) || typeof value === "bigint")) list.push(arrayIndex !== void 0 ? {
				v: toString(value),
				i: arrayIndex
			} : toString(value));
			else if (isArray(value)) {
				arr = true;
				for (let i = 0, len = value.length; i < len; i += 1) deepGet(value[i], path, index + 1, i);
			} else if (path.length) deepGet(value, path, index + 1, arrayIndex);
		}
	};
	deepGet(obj, isString(path) ? path.split(".") : path, 0);
	return arr ? list : list[0];
}

//#endregion
//#region src/core/config.ts
const Config = Object.freeze({
	isCaseSensitive: false,
	ignoreDiacritics: false,
	includeScore: false,
	keys: [],
	shouldSort: true,
	sortFn: (a, b) => a.score === b.score ? a.idx < b.idx ? -1 : 1 : a.score < b.score ? -1 : 1,
	includeMatches: false,
	findAllMatches: false,
	minMatchCharLength: 1,
	location: 0,
	threshold: .6,
	distance: 100,
	useExtendedSearch: false,
	useTokenSearch: false,
	tokenize: void 0,
	tokenMatch: "any",
	getFn: get,
	ignoreLocation: false,
	ignoreFieldNorm: false,
	fieldNormWeight: 1
});

//#endregion
//#region src/tools/fieldNorm.ts
function isWordSeparator(code) {
	return code >= 9 && code <= 13 || code === 32 || code === 160;
}
function norm(weight = 1, mantissa = 3) {
	const cache = /* @__PURE__ */ new Map();
	const m = Math.pow(10, mantissa);
	return {
		get(value) {
			let numTokens = 0;
			let inWord = false;
			for (let i = 0; i < value.length; i++) if (!isWordSeparator(value.charCodeAt(i))) {
				if (!inWord) {
					numTokens++;
					inWord = true;
				}
			} else inWord = false;
			if (numTokens === 0) numTokens = 1;
			if (cache.has(numTokens)) return cache.get(numTokens);
			const n = Math.round(m / Math.pow(numTokens, .5 * weight)) / m;
			cache.set(numTokens, n);
			return n;
		},
		clear() {
			cache.clear();
		}
	};
}

//#endregion
//#region src/tools/FuseIndex.ts
var FuseIndex = class {
	constructor({ getFn = Config.getFn, fieldNormWeight = Config.fieldNormWeight } = {}) {
		this.norm = norm(fieldNormWeight, 3);
		this.getFn = getFn;
		this.isCreated = false;
		this.docs = [];
		this.keys = [];
		this._keysMap = {};
		this.setIndexRecords();
	}
	setSources(docs = []) {
		this.docs = docs;
	}
	setIndexRecords(records = []) {
		this.records = records;
	}
	setKeys(keys = []) {
		this.keys = keys;
		this._keysMap = {};
		keys.forEach((key, idx) => {
			this._keysMap[key.id] = idx;
		});
	}
	create() {
		if (this.isCreated || !this.docs.length) return;
		this.isCreated = true;
		const len = this.docs.length;
		this.records = new Array(len);
		let recordCount = 0;
		if (isString(this.docs[0])) for (let i = 0; i < len; i++) {
			const record = this._createStringRecord(this.docs[i], i);
			if (record) this.records[recordCount++] = record;
		}
		else for (let i = 0; i < len; i++) this.records[recordCount++] = this._createObjectRecord(this.docs[i], i);
		this.records.length = recordCount;
		this.norm.clear();
	}
	add(doc, docIndex) {
		if (!Number.isInteger(docIndex) || docIndex < 0) throw new Error(INVALID_DOC_INDEX);
		if (isString(doc)) {
			const record = this._createStringRecord(doc, docIndex);
			if (record) this.records.push(record);
			return record;
		}
		const record = this._createObjectRecord(doc, docIndex);
		this.records.push(record);
		return record;
	}
	removeAt(idx) {
		if (!Number.isInteger(idx) || idx < 0) throw new Error(INVALID_DOC_INDEX);
		for (let i = 0, len = this.records.length; i < len; i += 1) if (this.records[i].i === idx) {
			this.records.splice(i, 1);
			break;
		}
		for (let i = 0, len = this.records.length; i < len; i += 1) if (this.records[i].i > idx) this.records[i].i -= 1;
	}
	removeAll(indices) {
		const toRemove = /* @__PURE__ */ new Set();
		for (const v of indices) if (Number.isInteger(v) && v >= 0) toRemove.add(v);
		if (toRemove.size === 0) return;
		this.records = this.records.filter((r) => !toRemove.has(r.i));
		const sorted = Array.from(toRemove).sort((a, b) => a - b);
		for (const record of this.records) {
			let lo = 0;
			let hi = sorted.length;
			while (lo < hi) {
				const mid = lo + hi >>> 1;
				if (sorted[mid] < record.i) lo = mid + 1;
				else hi = mid;
			}
			record.i -= lo;
		}
	}
	getValueForItemAtKeyId(item, keyId) {
		return item[this._keysMap[keyId]];
	}
	size() {
		return this.records.length;
	}
	_createStringRecord(doc, docIndex) {
		if (!isDefined(doc) || isBlank(doc)) return null;
		return {
			v: doc,
			i: docIndex,
			n: this.norm.get(doc)
		};
	}
	_createObjectRecord(doc, docIndex) {
		const record = {
			i: docIndex,
			$: {}
		};
		for (let keyIndex = 0, keyLen = this.keys.length; keyIndex < keyLen; keyIndex++) {
			const key = this.keys[keyIndex];
			const value = key.getFn ? key.getFn(doc) : this.getFn(doc, key.path);
			if (!isDefined(value)) continue;
			if (isArray(value)) {
				const subRecords = [];
				for (let i = 0, len = value.length; i < len; i += 1) {
					const item = value[i];
					if (!isDefined(item)) continue;
					if (isString(item)) {
						if (!isBlank(item)) {
							const subRecord = {
								v: item,
								i,
								n: this.norm.get(item)
							};
							subRecords.push(subRecord);
						}
					} else if (isDefined(item.v)) {
						const text = isString(item.v) ? item.v : toString(item.v);
						if (!isBlank(text)) {
							const subRecord = {
								v: text,
								i: item.i,
								n: this.norm.get(text)
							};
							subRecords.push(subRecord);
						}
					}
				}
				record.$[keyIndex] = subRecords;
			} else if (isString(value) && !isBlank(value)) {
				const subRecord = {
					v: value,
					n: this.norm.get(value)
				};
				record.$[keyIndex] = subRecord;
			}
		}
		return record;
	}
	toJSON() {
		return {
			keys: this.keys.map(({ getFn, ...key }) => key),
			records: this.records
		};
	}
};
function createIndex(keys, docs, { getFn = Config.getFn, fieldNormWeight = Config.fieldNormWeight } = {}) {
	const myIndex = new FuseIndex({
		getFn,
		fieldNormWeight
	});
	myIndex.setKeys(keys.map(createKey));
	myIndex.setSources(docs);
	myIndex.create();
	return myIndex;
}
function parseIndex(data, { getFn = Config.getFn, fieldNormWeight = Config.fieldNormWeight } = {}) {
	const { keys, records } = data;
	const myIndex = new FuseIndex({
		getFn,
		fieldNormWeight
	});
	myIndex.setKeys(keys);
	myIndex.setIndexRecords(records);
	return myIndex;
}

//#endregion
//#region src/search/bitap/search.ts
const KEEP = 3e4;
let bufA = /* @__PURE__ */ new Int32Array(0);
let bufB = /* @__PURE__ */ new Int32Array(0);
let charBuf = /* @__PURE__ */ new Int32Array(0);
const calcScore = (errors, loc, patternLen, expectedLocation, distance, ignoreLocation) => {
	const accuracy = errors / patternLen;
	if (ignoreLocation) return accuracy;
	const proximity = Math.abs(expectedLocation - loc);
	if (!distance) return proximity ? 1 : accuracy;
	return accuracy + proximity / distance;
};
function search(text, { pattern, alphabet: patternAlphabet, table }, location, { distance, threshold, findAllMatches, minMatchCharLength, includeMatches, ignoreLocation }) {
	const patternLen = pattern.length;
	const textLen = text.length;
	const expectedLocation = Math.max(0, Math.min(location, textLen));
	let currentThreshold = threshold;
	let bestLocation = expectedLocation;
	const computeMatches = minMatchCharLength > 1 || includeMatches;
	const matchMask = new Uint8Array(computeMatches ? textLen : 0);
	let index;
	while ((index = text.indexOf(pattern, bestLocation)) > -1) {
		currentThreshold = Math.min(calcScore(0, index, patternLen, expectedLocation, distance, ignoreLocation), currentThreshold);
		bestLocation = index + patternLen;
		if (computeMatches) matchMask.fill(1, index, bestLocation);
	}
	bestLocation = -1;
	let bitArr = bufA;
	let lastBitArr = bufB;
	let cm = charBuf;
	let low = 1;
	let finalScore = 1;
	let bestErrors = 0;
	let binMax = patternLen + textLen;
	const mask = 1 << patternLen - 1;
	for (let i = 0; i < patternLen; i += 1) {
		let binMin = 0;
		let binMid = binMax;
		while (binMin < binMid) {
			if (calcScore(i, expectedLocation + binMid, patternLen, expectedLocation, distance, ignoreLocation) <= currentThreshold) binMin = binMid;
			else binMax = binMid;
			binMid = Math.floor((binMax - binMin) / 2 + binMin);
		}
		binMax = binMid;
		let start = Math.max(1, expectedLocation - binMid + 1);
		const finish = findAllMatches ? textLen : Math.min(expectedLocation + binMid, textLen) + patternLen;
		if (!i) {
			low = Math.max(1, Math.min(start, 2 * expectedLocation - finish + 1)) | 0;
			if (bitArr.length < finish + 2) {
				bitArr = new Int32Array(finish * 2 + 4);
				lastBitArr = new Int32Array(finish * 2 + 4);
				cm = new Int32Array(finish * 2 + 4);
				if (finish < KEEP) {
					bufA = bitArr;
					bufB = lastBitArr;
					charBuf = cm;
				}
			}
			for (let k = low; k <= finish; k += 1) cm[k] = k > textLen ? 0 : table[text.charCodeAt(k - 1)] ?? patternAlphabet[text.charCodeAt(k - 1)] | 0;
		}
		bitArr[finish + 1] = (1 << i) - 1;
		let j = finish;
		for (; j >= start; j -= 1) {
			let bits = (bitArr[j + 1] << 1 | 1) & cm[j];
			if (i) bits |= (lastBitArr[j + 1] | lastBitArr[j]) << 1 | 1 | lastBitArr[j + 1];
			bitArr[j] = bits;
			if (bits & mask) {
				finalScore = calcScore(i, j - 1, patternLen, expectedLocation, distance, ignoreLocation);
				if (finalScore <= currentThreshold) {
					currentThreshold = finalScore;
					bestLocation = j - 1;
					bestErrors = i;
					if (bestLocation <= expectedLocation) {
						j -= 1;
						break;
					}
					start = Math.max(1, 2 * expectedLocation - bestLocation);
				}
			}
		}
		if ((i + 1) / patternLen > currentThreshold) break;
		bitArr.fill(0, low, j + 1);
		const tmp = lastBitArr;
		lastBitArr = bitArr;
		bitArr = tmp;
	}
	if (computeMatches && bestLocation >= 0) {
		const matchEnd = Math.min(textLen - 1, bestLocation + patternLen - 1 + bestErrors);
		for (let k = bestLocation; k <= matchEnd; k += 1) if (patternAlphabet[text.charCodeAt(k)]) matchMask[k] = 1;
	}
	const result = {
		isMatch: bestLocation >= 0,
		score: Math.max(.001, finalScore)
	};
	if (computeMatches) {
		const indices = [];
		for (let k = 0, start = -1; k <= textLen; k += 1) if (matchMask[k]) {
			if (start < 0) start = k;
		} else if (start >= 0) {
			if (k - start >= minMatchCharLength) indices.push([start, k - 1]);
			start = -1;
		}
		if (!indices.length) result.isMatch = false;
		else if (includeMatches) result.indices = indices;
	}
	return result;
}

//#endregion
//#region src/search/bitap/canMatch.ts
function canMatch(text, { pattern, alphabet, table, startIndex }, { location, distance, threshold, ignoreLocation }, any) {
	const n = text.length;
	const m = pattern.length;
	const expected = Math.max(0, Math.min(location + startIndex, n));
	const w = ignoreLocation || distance < 0 ? n : threshold * distance + 1 || n;
	let j = Math.min(n, expected + w + 2 * m) | 0;
	const stop = expected > w ? expected - w : 0;
	const last = 1 << m - 1;
	let pv = -1;
	let mv = 0;
	let score = m;
	let best = m;
	let kmax = Math.min(m, Math.floor(threshold * m));
	if (kmax < m && (kmax + 1) / m <= threshold) kmax++;
	if (kmax / m > threshold) kmax--;
	if (ignoreLocation) {
		if (kmax >= m) kmax = m - 1;
	} else if (!(distance > 0)) kmax = m;
	if (j - stop > 32 && threshold >= 0 && (j < n ? text.slice(stop, j).includes(pattern) : text.includes(pattern, stop))) return -1;
	while (j-- > stop) {
		const c = text.charCodeAt(j);
		const eq = table[c] ?? alphabet[c] | 0;
		const xv = eq | mv;
		const xh = (eq & pv) + pv ^ pv | eq;
		let ph = mv | ~(xh | pv);
		let mh = pv & xh;
		if (ph & last) score++;
		else if (mh & last) score--;
		ph <<= 1;
		mh <<= 1;
		pv = mh | ~(xv | ph);
		mv = ph & xv;
		if (score <= kmax) {
			if (!ignoreLocation) {
				if (calcScore(score, j, m, expected, distance, false) <= threshold) return 1;
			} else if (score < best) {
				best = score;
				if (any || !score) break;
			}
		}
	}
	return best < m && best / m <= threshold ? ~best : 0;
}

//#endregion
//#region src/search/bitap/createPatternAlphabet.ts
function createPatternAlphabet(pattern) {
	const mask = {};
	for (let i = 0, len = pattern.length; i < len; i += 1) {
		const code = pattern.charCodeAt(i);
		mask[code] |= 1 << len - i - 1;
	}
	return mask;
}

//#endregion
//#region src/helpers/mergeIndices.ts
function mergeIndices(indices) {
	if (indices.length <= 1) return indices;
	indices.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const merged = [indices[0]];
	for (let i = 1, len = indices.length; i < len; i += 1) {
		const last = merged[merged.length - 1];
		const curr = indices[i];
		if (curr[0] <= last[1] + 1) last[1] = Math.max(last[1], curr[1]);
		else merged.push(curr);
	}
	return merged;
}

//#endregion
//#region src/helpers/diacritics.ts
const NON_DECOMPOSABLE_MAP = {
	"ł": "l",
	"Ł": "L",
	"đ": "d",
	"Đ": "D",
	"ø": "o",
	"Ø": "O",
	"ħ": "h",
	"Ħ": "H",
	"ŧ": "t",
	"Ŧ": "T",
	"ı": "i",
	"ß": "ss"
};
const NON_DECOMPOSABLE_RE = new RegExp("[" + Object.keys(NON_DECOMPOSABLE_MAP).join("") + "]", "g");
const MARK_RANGES = "lc 33 7o 6 7c 18 2 0 2 1 2 1 2 0 21 a 1d k h 0 2u 6 3 5 3 1 2 3 10 0 v q 2k a 1n 8 a 0 p 3 2 8 2 2 2 4 18 2 3c e 2 w 1j 2 2 h 2 6 b 1 u 2 1l 0 2 6 3 1 3 2 a 0 b 1 r 0 3 2 1l 0 2 4 5 1 3 2 4 0 v 1 4 0 c 2 1l 0 2 7 2 2 2 2 l 1 n 5 2 2 1l 0 2 6 3 1 3 2 9 1 b 1 v 0 1o 4 4 2 2 3 a 0 15 4 1m 6 2 2 2 3 8 1 c 1 u 2 1l 0 2 6 2 2 2 3 8 1 c 1 t 3 1k 1 2 6 2 2 2 3 a 0 b 1 v 1 1z 0 5 5 2 0 2 7 j 1 1q 0 3 6 d 7 2r 0 3 5 2 1 c 5 23 1 s 0 2 0 2 0 5 1 1e j 2 1 6 a 2 z a 0 2t j o 3 5 2 2 2 3 6 4 3 e b 2 0 b 3 jk 2 qb 2 u 2 u 1 v 1 1t v a 0 1a 2 3c 1 z 0 3b b 5 b 64 4 1m 9 2 s 3 0 1d e 1u 4 1c g 13 8 d 2 v c 1l d 1d j 49 2 2 k 5 0 5 2 3 2 5j 1l 2 4 k1 w 2db 2 3y 0 2p v ff 5 2y 1 n9x 3 2 9 x 1 29 1 7l 0 4 0 5 0 o 4 2h 1 1f h r h e 0 13 7 q c 19 3 1c d 11 0 1w d d 0 9 1 1a 2 1f 0 2 2 3 1 6 1 2 0 16 4 6 1 6l 7 2 1 fn5 0 ki f h f".split(" ");
let markClass = "";
for (let i = 0, code = 0; i < MARK_RANGES.length;) markClass += String.fromCharCode(code += parseInt(MARK_RANGES[i++], 36)) + "-" + String.fromCharCode(code += parseInt(MARK_RANGES[i++], 36));
const COMBINING_MARKS_RE = new RegExp("[" + markClass + "]", "g");
const stripDiacritics = (str) => str.normalize("NFD").replace(COMBINING_MARKS_RE, "").replace(NON_DECOMPOSABLE_RE, (ch) => NON_DECOMPOSABLE_MAP[ch]);

//#endregion
//#region src/search/bitap/index.ts
var BitapSearch = class {
	constructor(pattern, { location = Config.location, threshold = Config.threshold, distance = Config.distance, includeMatches = Config.includeMatches, findAllMatches = Config.findAllMatches, minMatchCharLength = Config.minMatchCharLength, isCaseSensitive = Config.isCaseSensitive, ignoreDiacritics = Config.ignoreDiacritics, ignoreLocation = Config.ignoreLocation } = {}) {
		this.options = {
			location,
			threshold,
			distance,
			includeMatches,
			findAllMatches,
			minMatchCharLength,
			isCaseSensitive,
			ignoreDiacritics,
			ignoreLocation
		};
		pattern = isCaseSensitive ? pattern : pattern.toLowerCase();
		pattern = ignoreDiacritics ? stripDiacritics(pattern) : pattern;
		this.pattern = pattern;
		this.chunks = [];
		for (let i = 0, len = pattern.length; i < len; i += 32) {
			const startIndex = Math.max(0, Math.min(i, len - 32));
			const chunk = pattern.substr(startIndex, 32);
			const alphabet = createPatternAlphabet(chunk);
			this.chunks.push({
				pattern: chunk,
				alphabet,
				table: (/* @__PURE__ */ new Int32Array(256)).map((_, code) => alphabet[code]),
				startIndex
			});
		}
	}
	searchIn(text) {
		const { isCaseSensitive, ignoreDiacritics, includeMatches, location, ignoreLocation, minMatchCharLength } = this.options;
		text = isCaseSensitive ? text : text.toLowerCase();
		text = ignoreDiacritics ? stripDiacritics(text) : text;
		if (this.pattern === text) return text.length < minMatchCharLength ? {
			isMatch: false,
			score: 1
		} : includeMatches ? {
			isMatch: true,
			score: 0,
			indices: [[0, text.length - 1]]
		} : {
			isMatch: true,
			score: 0
		};
		const direct = ignoreLocation && !includeMatches && !(minMatchCharLength > 1);
		let hasMatches = false;
		let totalScore = 0;
		for (const chunk of this.chunks) {
			const r = canMatch(text, chunk, this.options, !direct);
			if (r) {
				hasMatches = true;
				if (!direct) break;
			}
			totalScore += r ? Math.max(.001, ~r / chunk.pattern.length) : 1;
		}
		const allIndices = [];
		if (hasMatches && !direct) {
			hasMatches = false;
			totalScore = 0;
			for (const chunk of this.chunks) {
				const { isMatch, score, indices } = search(text, chunk, location + chunk.startIndex, this.options);
				if (isMatch) hasMatches = true;
				totalScore += score;
				if (isMatch && indices) allIndices.push(...indices);
			}
		}
		const result = {
			isMatch: hasMatches,
			score: hasMatches ? totalScore / this.chunks.length : 1
		};
		if (hasMatches && includeMatches) result.indices = mergeIndices(allIndices);
		return result;
	}
};

//#endregion
//#region src/core/register.ts
const registeredSearchers = [];
function register(...args) {
	registeredSearchers.push(...args);
}
let objectCompiler = null;
function getObjectCompiler() {
	return objectCompiler;
}
function createSearcher(pattern, options) {
	for (let i = 0, len = registeredSearchers.length; i < len; i += 1) {
		const searcherClass = registeredSearchers[i];
		if (searcherClass.condition(pattern, options)) return new searcherClass(pattern, options);
	}
	return new BitapSearch(pattern, options);
}

//#endregion
//#region src/core/queryParser.ts
const LogicalOperator = {
	AND: "$and",
	OR: "$or"
};
const KeyType = {
	PATH: "$path",
	PATTERN: "$val"
};
const isExpression = (query) => !!(query[LogicalOperator.AND] || query[LogicalOperator.OR]);
const isPath = (query) => !!query[KeyType.PATH];
const isLeaf = (query) => !isArray(query) && isObject(query) && !isExpression(query);
const convertToExplicit = (query) => ({ [LogicalOperator.AND]: Object.keys(query).map((key) => ({ [key]: query[key] })) });
function parse(query, options, { auto = true } = {}) {
	const next = (query) => {
		if (isString(query)) {
			const obj = {
				keyId: null,
				pattern: query
			};
			if (auto) obj.searcher = createSearcher(query, options);
			return obj;
		}
		const keys = Object.keys(query);
		const isQueryPath = isPath(query);
		if (!isQueryPath && keys.length > 1 && !isExpression(query)) return next(convertToExplicit(query));
		if (isLeaf(query)) {
			const key = isQueryPath ? query[KeyType.PATH] : keys[0];
			const value = isQueryPath ? query[KeyType.PATTERN] : query[key];
			if (isString(value)) {
				const obj = {
					keyId: createKeyId(key),
					pattern: value
				};
				if (auto) obj.searcher = createSearcher(value, options);
				return obj;
			}
			if (isObjectLike(value) && !isArray(value)) {
				const obj = {
					keyId: createKeyId(key),
					fieldQuery: value
				};
				if (auto) {
					const compile = getObjectCompiler();
					if (!compile) throw new Error(OBJECT_QUERY_UNAVAILABLE);
					obj.searcher = compile(value, isArray(key) ? key.join(".") : String(key), options);
				}
				return obj;
			}
			throw new Error(LOGICAL_SEARCH_INVALID_QUERY_FOR_KEY(key));
		}
		const node = {
			children: [],
			operator: keys[0]
		};
		keys.forEach((key) => {
			const value = query[key];
			if (isArray(value)) value.forEach((item) => {
				node.children.push(next(item));
			});
		});
		return node;
	};
	if (!isExpression(query)) query = convertToExplicit(query);
	return next(query);
}

//#endregion
//#region src/core/computeScore.ts
function computeScoreSingle(matches, { ignoreFieldNorm = Config.ignoreFieldNorm }) {
	let totalScore = 1;
	for (const { key, norm, score } of matches) {
		const weight = key ? key.weight : null;
		totalScore *= Math.pow(score === 0 && weight ? Number.EPSILON : score, (weight || 1) * (ignoreFieldNorm ? 1 : norm));
	}
	return totalScore;
}
function computeScore(results, options) {
	for (const result of results) result.score = computeScoreSingle(result.matches, options);
}

//#endregion
//#region src/tools/MaxHeap.ts
var MaxHeap = class {
	constructor(limit, comparator) {
		this.limit = limit;
		this.heap = [];
		this.comparator = comparator;
	}
	insert(item) {
		const { heap, comparator } = this;
		let i = heap.length;
		if (i < this.limit) while (i > 0) {
			const parent = i - 1 >> 1;
			if (comparator(item, heap[parent]) <= 0) break;
			heap[i] = heap[parent];
			i = parent;
		}
		else if (comparator(item, heap[0]) < 0) {
			const len = i;
			i = 0;
			for (;;) {
				const left = 2 * i + 1;
				if (left >= len) break;
				let next = comparator(heap[left], item) > 0 ? left : -1;
				if (left + 1 < len && comparator(heap[left + 1], next < 0 ? item : heap[left]) > 0) next = left + 1;
				if (next < 0) break;
				heap[i] = heap[next];
				i = next;
			}
		} else return;
		heap[i] = item;
	}
	extractSorted() {
		return this.heap.sort(this.comparator);
	}
};

//#endregion
//#region src/core/formatMatches.ts
function formatMatches(result) {
	const matches = [];
	result.matches.forEach((match) => {
		if (!match.indices?.length) return;
		const obj = {
			indices: match.indices,
			value: match.value
		};
		if (match.key) obj.key = match.key.id;
		if (match.idx > -1) obj.refIndex = match.idx;
		matches.push(obj);
	});
	return matches;
}

//#endregion
//#region src/core/format.ts
function format(results, docs, { includeMatches = Config.includeMatches, includeScore = Config.includeScore }) {
	return results.map((result) => {
		const { idx } = result;
		const data = {
			item: docs[idx],
			refIndex: idx
		};
		if (includeMatches) data.matches = formatMatches(result);
		if (includeScore) data.score = result.score;
		return data;
	});
}

//#endregion
//#region src/search/token/analyzer.ts
const DEFAULT_TOKEN = /[\p{L}\p{M}\p{N}_]+/gu;
const warned = /* @__PURE__ */ new WeakSet();
function warnNonGlobal(regex) {
	if (!warned.has(regex)) {
		warned.add(regex);
		console.warn(`[Fuse] tokenize regex ${regex} lacks the global flag; only the first match per text will be returned. Add the 'g' flag.`);
	}
}
function resolveTokenize(tokenize) {
	if (typeof tokenize === "function") {
		let validated = false;
		return (text) => {
			const result = tokenize(text);
			if (!validated) {
				validated = true;
				if (!Array.isArray(result) || result.some((t) => typeof t !== "string")) throw new Error(`[Fuse] tokenize function must return string[]; received ${Array.isArray(result) ? "array containing non-strings" : typeof result}.`);
			}
			return result;
		};
	}
	if (tokenize instanceof RegExp) {
		if (!tokenize.global) warnNonGlobal(tokenize);
		return (text) => text.match(tokenize) || [];
	}
	return (text) => text.match(DEFAULT_TOKEN) || [];
}
function createAnalyzer({ isCaseSensitive = false, ignoreDiacritics = false, tokenize } = {}) {
	const tokenizeFn = resolveTokenize(tokenize);
	return { tokenize(text) {
		if (!isCaseSensitive) text = text.toLowerCase();
		if (ignoreDiacritics) text = stripDiacritics(text);
		return tokenizeFn(text);
	} };
}

//#endregion
//#region src/search/token/InvertedIndex.ts
function addField(index, text, docIdx, analyzer) {
	const tokens = analyzer.tokenize(text);
	if (!tokens.length) return;
	index.fieldCount++;
	index.docFieldCount.set(docIdx, (index.docFieldCount.get(docIdx) || 0) + 1);
	const distinctTerms = new Set(tokens);
	let perDocTerms = index.docTermFieldHits.get(docIdx);
	if (!perDocTerms) {
		perDocTerms = /* @__PURE__ */ new Map();
		index.docTermFieldHits.set(docIdx, perDocTerms);
	}
	for (const term of distinctTerms) {
		perDocTerms.set(term, (perDocTerms.get(term) || 0) + 1);
		index.df.set(term, (index.df.get(term) || 0) + 1);
	}
}
function ingestRecord(index, record, keyCount, analyzer) {
	const { i: docIdx, v, $: fields } = record;
	if (v !== void 0) {
		addField(index, v, docIdx, analyzer);
		return;
	}
	if (!fields) return;
	for (let keyIdx = 0; keyIdx < keyCount; keyIdx++) {
		const value = fields[keyIdx];
		if (!value) continue;
		if (Array.isArray(value)) for (const sub of value) addField(index, sub.v, docIdx, analyzer);
		else addField(index, value.v, docIdx, analyzer);
	}
}
function buildInvertedIndex(records, keyCount, analyzer) {
	const index = {
		fieldCount: 0,
		df: /* @__PURE__ */ new Map(),
		docFieldCount: /* @__PURE__ */ new Map(),
		docTermFieldHits: /* @__PURE__ */ new Map()
	};
	for (const record of records) ingestRecord(index, record, keyCount, analyzer);
	return index;
}
function addToInvertedIndex(index, record, keyCount, analyzer) {
	ingestRecord(index, record, keyCount, analyzer);
}
function removeFromInvertedIndex(index, docIdx) {
	const fieldCount = index.docFieldCount.get(docIdx);
	if (fieldCount === void 0) return;
	index.fieldCount -= fieldCount;
	index.docFieldCount.delete(docIdx);
	const perDocTerms = index.docTermFieldHits.get(docIdx);
	if (!perDocTerms) return;
	for (const [term, hits] of perDocTerms) {
		const next = (index.df.get(term) || 0) - hits;
		if (next <= 0) index.df.delete(term);
		else index.df.set(term, next);
	}
	index.docTermFieldHits.delete(docIdx);
}
function removeAndShiftInvertedIndex(index, removedIndices) {
	if (removedIndices.length === 0) return;
	const sorted = Array.from(new Set(removedIndices)).sort((a, b) => a - b);
	for (const idx of sorted) removeFromInvertedIndex(index, idx);
	const shift = (oldIdx) => {
		let lo = 0;
		let hi = sorted.length;
		while (lo < hi) {
			const mid = lo + hi >>> 1;
			if (sorted[mid] < oldIdx) lo = mid + 1;
			else hi = mid;
		}
		return oldIdx - lo;
	};
	const firstRemoved = sorted[0];
	const shiftedDocFieldCount = /* @__PURE__ */ new Map();
	for (const [oldKey, count] of index.docFieldCount) shiftedDocFieldCount.set(oldKey > firstRemoved ? shift(oldKey) : oldKey, count);
	index.docFieldCount = shiftedDocFieldCount;
	const shiftedDocTermFieldHits = /* @__PURE__ */ new Map();
	for (const [oldKey, terms] of index.docTermFieldHits) shiftedDocTermFieldHits.set(oldKey > firstRemoved ? shift(oldKey) : oldKey, terms);
	index.docTermFieldHits = shiftedDocTermFieldHits;
}

//#endregion
//#region src/core/index.ts
function pushMatches(out, key, value, searcher) {
	if (isArray(value)) {
		for (const sub of value) if (sub && isDefined(sub.v)) pushMatch(out, key, sub, true, searcher);
	} else if (isDefined(value)) pushMatch(out, key, value, false, searcher);
}
function pushMatch(out, key, sub, inArray, searcher) {
	const text = sub.v;
	const searchResult = searcher.searchIn(text);
	if (searchResult.isMatch) {
		const match = inArray ? {
			score: searchResult.score,
			key,
			value: text,
			idx: sub.i,
			norm: sub.n,
			indices: searchResult.indices,
			hasInverse: searchResult.hasInverse
		} : {
			score: searchResult.score,
			key,
			value: text,
			norm: sub.n,
			indices: searchResult.indices,
			hasInverse: searchResult.hasInverse
		};
		if (searchResult.termCount !== void 0) {
			match.matchedMask = searchResult.matchedMask;
			match.matchedTerms = searchResult.matchedTerms;
			match.termCount = searchResult.termCount;
		}
		out.push(match);
	}
}
var Fuse = class {
	constructor(docs, options, index) {
		this.options = {
			...Config,
			...options
		};
		if (this.options.useExtendedSearch && true) throw new Error(EXTENDED_SEARCH_UNAVAILABLE);
		if (this.options.useTokenSearch && true) throw new Error(TOKEN_SEARCH_UNAVAILABLE);
		this._keyStore = new KeyStore(this.options.keys);
		this._docs = docs;
		this._myIndex = null;
		this._invertedIndex = null;
		this.setCollection(docs, index);
		this._lastQuery = null;
		this._lastSearcher = null;
	}
	_getSearcher(query) {
		if (this._lastQuery === query) return this._lastSearcher;
		const searcher = createSearcher(query, this._invertedIndex ? {
			...this.options,
			_invertedIndex: this._invertedIndex
		} : this.options);
		this._lastQuery = query;
		this._lastSearcher = searcher;
		return searcher;
	}
	setCollection(docs, index) {
		this._docs = docs;
		if (index && !(index instanceof FuseIndex)) throw new Error(INCORRECT_INDEX_TYPE);
		this._myIndex = index || createIndex(this.options.keys, this._docs, {
			getFn: this.options.getFn,
			fieldNormWeight: this.options.fieldNormWeight
		});
		if (this.options.useTokenSearch) {
			const analyzer = createAnalyzer({
				isCaseSensitive: this.options.isCaseSensitive,
				ignoreDiacritics: this.options.ignoreDiacritics,
				tokenize: this.options.tokenize
			});
			this._invertedIndex = buildInvertedIndex(this._myIndex.records, this._myIndex.keys.length, analyzer);
		}
		this._invalidateSearcherCache();
	}
	add(doc) {
		if (!isDefined(doc)) return;
		this._docs.push(doc);
		const record = this._myIndex.add(doc, this._docs.length - 1);
		if (this._invertedIndex && record) {
			const analyzer = createAnalyzer({
				isCaseSensitive: this.options.isCaseSensitive,
				ignoreDiacritics: this.options.ignoreDiacritics,
				tokenize: this.options.tokenize
			});
			addToInvertedIndex(this._invertedIndex, record, this._myIndex.keys.length, analyzer);
		}
		this._invalidateSearcherCache();
	}
	remove(predicate = () => false) {
		const results = [];
		const indicesToRemove = [];
		for (let i = 0, len = this._docs.length; i < len; i += 1) if (predicate(this._docs[i], i)) {
			results.push(this._docs[i]);
			indicesToRemove.push(i);
		}
		if (indicesToRemove.length) {
			if (this._invertedIndex) removeAndShiftInvertedIndex(this._invertedIndex, indicesToRemove);
			const toRemove = new Set(indicesToRemove);
			this._docs = this._docs.filter((_, i) => !toRemove.has(i));
			this._myIndex.removeAll(indicesToRemove);
			this._invalidateSearcherCache();
		}
		return results;
	}
	removeAt(idx) {
		if (!Number.isInteger(idx) || idx < 0 || idx >= this._docs.length) throw new Error(INVALID_DOC_INDEX);
		if (this._invertedIndex) removeAndShiftInvertedIndex(this._invertedIndex, [idx]);
		const doc = this._docs.splice(idx, 1)[0];
		this._myIndex.removeAt(idx);
		this._invalidateSearcherCache();
		return doc;
	}
	_invalidateSearcherCache() {
		this._lastQuery = null;
		this._lastSearcher = null;
	}
	getIndex() {
		return this._myIndex;
	}
	_normalizedKeys() {
		return this._myIndex.keys.map((key) => this._keyStore.get(key.id) || key);
	}
	search(query, options) {
		const { limit = -1 } = options || {};
		const { includeMatches, includeScore, shouldSort, sortFn, ignoreFieldNorm } = this.options;
		if (isString(query) && !query.trim()) {
			let docs = this._docs.map((item, idx) => ({
				item,
				refIndex: idx
			}));
			if (isNumber(limit) && limit > -1) docs = docs.slice(0, limit);
			return docs;
		}
		const useHeap = shouldSort && isNumber(limit) && limit > 0 && isString(query);
		const comparator = sortFn;
		const stable = (a, b) => comparator(a, b) || a.idx - b.idx;
		let results;
		if (isString(query)) {
			const opts = {
				heap: useHeap ? new MaxHeap(limit, stable) : void 0,
				ignoreFieldNorm
			};
			results = isString(this._docs[0]) ? this._searchStringList(query, opts) : this._searchObjectList(query, opts);
		} else {
			results = this._searchLogical(query);
			computeScore(results, { ignoreFieldNorm });
		}
		if (!useHeap) {
			if (shouldSort) results.sort(isString(query) ? stable : comparator);
			if (isNumber(limit) && limit > -1) results = results.slice(0, limit);
		}
		return format(results, this._docs, {
			includeMatches,
			includeScore
		});
	}
	_searchStringList(query, opts = {}) {
		const heap = opts.heap;
		const searcher = this._getSearcher(query);
		const requireAllTokens = this.options.useTokenSearch && this.options.tokenMatch === "all";
		const records = this._myIndex.records;
		const results = [];
		for (const record of records) {
			if (!record) continue;
			const text = record.v;
			if (!isDefined(text)) continue;
			const searchResult = searcher.searchIn(text);
			if (searchResult.isMatch) {
				const match = {
					score: searchResult.score,
					value: text,
					norm: record.n,
					indices: searchResult.indices
				};
				if (requireAllTokens) {
					match.matchedMask = searchResult.matchedMask;
					match.matchedTerms = searchResult.matchedTerms;
					match.termCount = searchResult.termCount;
				}
				const matches = [match];
				if (!requireAllTokens || this._coversAllTokens(matches)) {
					const result = {
						item: text,
						idx: record.i,
						matches
					};
					result.score = computeScoreSingle(matches, opts);
					heap ? heap.insert(result) : results.push(result);
				}
			}
		}
		return heap ? heap.extractSorted() : results;
	}
	_searchLogical(query) {
		throw new Error(LOGICAL_SEARCH_UNAVAILABLE);
	}
	_searchObjectList(query, opts = {}) {
		const heap = opts.heap;
		const searcher = this._getSearcher(query);
		const requireAllTokens = this.options.useTokenSearch && this.options.tokenMatch === "all";
		const records = this._myIndex.records;
		const keys = this._normalizedKeys();
		const results = [];
		let matches = [];
		for (const record of records) {
			if (!record) continue;
			const item = record.$;
			if (!isDefined(item)) continue;
			let anyKeyFailed = false;
			let hasInverse = false;
			for (let k = 0; k < keys.length; k += 1) {
				const start = matches.length;
				pushMatches(matches, keys[k], item[k], searcher);
				if (matches.length > start) {
					if (matches[start].hasInverse) hasInverse = true;
				} else anyKeyFailed = true;
			}
			if (matches.length && !(hasInverse && anyKeyFailed) && (!requireAllTokens || this._coversAllTokens(matches))) {
				const result = {
					idx: record.i,
					item,
					matches
				};
				result.score = computeScoreSingle(matches, opts);
				heap ? heap.insert(result) : results.push(result);
				matches = [];
			} else matches.length = 0;
		}
		return heap ? heap.extractSorted() : results;
	}
	_findMatches({ key, value, searcher }) {
		const matches = [];
		pushMatches(matches, key, value, searcher);
		return matches;
	}
	_coversAllTokens(matches) {
		const termCount = matches[0].termCount;
		if (termCount === void 0) return true;
		if (termCount <= 31) {
			let coverage = 0;
			for (let i = 0; i < matches.length; i++) coverage |= matches[i].matchedMask || 0;
			return coverage === 2 ** termCount - 1;
		}
		const coverage = /* @__PURE__ */ new Set();
		for (let i = 0; i < matches.length; i++) {
			const terms = matches[i].matchedTerms;
			if (terms) for (const t of terms) coverage.add(t);
		}
		return coverage.size === termCount;
	}
};

//#endregion
//#region src/entry.ts
Fuse.version = "7.6.0-beta.0";
Fuse.createIndex = createIndex;
Fuse.parseIndex = parseIndex;
Fuse.config = Config;
Fuse.match = function(pattern, text, options) {
	if (options && options.useTokenSearch) throw new Error(FUSE_MATCH_TOKEN_SEARCH_UNSUPPORTED);
	return createSearcher(pattern, {
		...Config,
		...options
	}).searchIn(text);
};
Fuse.parseQuery = parse;
Fuse.use = function(...plugins) {
	plugins.forEach((plugin) => register(plugin));
};
var entry_default = Fuse;

//#endregion
export { entry_default as default };