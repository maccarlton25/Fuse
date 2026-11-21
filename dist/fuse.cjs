/**
 * Fuse.js v7.6.0-beta.0 - Lightweight fuzzy-search (http://fusejs.io)
 *
 * Copyright (c) 2026 Kiro Risk (http://kiro.me)
 * All Rights Reserved. Apache Software License 2.0
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */

//#region src/helpers/typeGuards.ts
const isArray = Array.isArray;
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
	const c = typeof value == "string" ? value.charCodeAt(0) : 0;
	return !(c > 32 && c < 127) && !value.trim().length;
}
function getTag(value) {
	return value == null ? value === void 0 ? "[object Undefined]" : "[object Null]" : Object.prototype.toString.call(value);
}

//#endregion
//#region src/core/errorMessages.ts
const INCORRECT_INDEX_TYPE = "Incorrect 'index' type";
const INVALID_DOC_INDEX = "Invalid doc index: must be a non-negative integer within the bounds of the docs array";
const LOGICAL_SEARCH_INVALID_QUERY_FOR_KEY = (key) => `Invalid value for key ${key}`;
const UNKNOWN_QUERY_OPERATOR = (op) => `Unknown query operator '${op}'`;
const EMPTY_QUERY_VALUE = (op, key) => `Empty value for operator '${op}' on key '${key}'`;
const INVALID_FIELD_QUERY = (key, reason) => `Invalid field query for key '${key}': ${reason}`;
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
const isLeaf$1 = (value) => isString(value) || isNumber(value) || isBoolean(value) || typeof value === "bigint";
function walk(obj, path, index, list, arrayIndex) {
	for (;; index++) {
		if (!isDefined(obj)) return list;
		if (!path[index]) break;
		const value = obj[path[index]];
		if (index === path.length - 1 && isLeaf$1(value)) {
			obj = toString(value);
			break;
		}
		if (isArray(value)) {
			list = list || [];
			for (let i = 0, len = value.length; i < len; i += 1) walk(value[i], path, index + 1, list, i);
			return list;
		}
		obj = value;
	}
	if (!list) return obj;
	list.push({
		v: obj,
		i: arrayIndex
	});
	return list;
}
function get(obj, path) {
	return walk(obj, isString(path) ? path.split(".") : path, 0);
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
const RARE_SEPARATORS = /[\t-\r\xa0]/;
function norm(weight = 1, mantissa = 3) {
	let cache = [];
	const m = Math.pow(10, mantissa);
	return {
		get(value) {
			const rare = RARE_SEPARATORS.test(value);
			let numTokens = 0;
			for (let i = 0, inWord = false, len = value.length; i < len; i++) {
				const c = value.charCodeAt(i);
				if (c > 32 ? c === 160 : c === 32 || c > 8 && c < 14) inWord = false;
				else if (!inWord) {
					numTokens++;
					inWord = rare;
					if (!rare && (i = value.indexOf(" ", i)) < 0) break;
				}
			}
			numTokens = numTokens || 1;
			return cache[numTokens] || (cache[numTokens] = Math.round(m / Math.pow(numTokens, .5 * weight)) / m);
		},
		clear() {
			cache = [];
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
		else {
			const template = {};
			for (let k = 0; k < this.keys.length; k++) template[k] = void 0;
			for (let i = 0; i < len; i++) this.records[recordCount++] = this._createObjectRecord(this.docs[i], i, { ...template });
		}
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
	_createObjectRecord(doc, docIndex, $ = {}) {
		for (let keyIndex = 0, keyLen = this.keys.length; keyIndex < keyLen; keyIndex++) {
			const key = this.keys[keyIndex];
			const path = key.path;
			let value;
			let subRecords;
			if (key.getFn) value = key.getFn(doc);
			else if (this.getFn !== get || path.length > 1 || !path[0]) value = this.getFn(doc, path);
			else {
				value = doc?.[path[0]];
				if (isLeaf$1(value)) value = toString(value);
				else if (isArray(value)) {
					const items = value;
					value = [];
					subRecords = [];
					for (let i = 0, len = items.length; i < len; i += 1) {
						const item = items[i];
						if (value.length || !isString(item)) value.push({
							v: item,
							i
						});
						else if (!isBlank(item)) subRecords.push({
							v: item,
							i,
							n: this.norm.get(item)
						});
					}
				}
			}
			if (isArray(value)) {
				subRecords = subRecords || [];
				for (let i = 0, len = value.length; i < len; i += 1) {
					const item = value[i];
					const str = isString(item);
					const text = str ? item : isDefined(item?.v) ? isString(item.v) ? item.v : toString(item.v) : "";
					if (!isBlank(text)) subRecords.push({
						v: text,
						i: str ? i : item.i,
						n: this.norm.get(text)
					});
				}
				$[keyIndex] = subRecords;
			} else if (isString(value) && !isBlank(value)) $[keyIndex] = {
				v: value,
				n: this.norm.get(value)
			};
			else delete $[keyIndex];
		}
		return {
			i: docIndex,
			$
		};
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
function canMatch(text, { pattern, alphabet, table, startIndex }, { location, distance, threshold, ignoreLocation }) {
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
	if (j - stop > 256 && threshold >= 0 && text.slice(stop, j).includes(pattern)) return -1;
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
		if (ignoreLocation) {
			if (score < best) best = score;
		} else if (calcScore(score, j, m, expected, distance, ignoreLocation) <= threshold) return 1;
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
			const r = canMatch(text, chunk, this.options);
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
//#region src/search/extended/matchers.ts
const MULTI_MATCH_TYPES = /* @__PURE__ */ new Set(["fuzzy", "include"]);
function isInverse(type) {
	return type.startsWith("inverse");
}
const FUZZY_OPTION_KEYS = "location threshold distance includeMatches findAllMatches minMatchCharLength isCaseSensitive ignoreDiacritics ignoreLocation".split(" ");
const def = (type, prefix, suffix, create) => ({
	type,
	multiRegex: new RegExp(`^${prefix}"(.*)"${suffix}$`),
	singleRegex: new RegExp(`^${prefix}(.*)${suffix}$`),
	create
});
const matchers = [
	def("exact", "=", "", (pattern) => ({
		type: "exact",
		search(text) {
			const isMatch = text === pattern;
			return {
				isMatch,
				score: isMatch ? 0 : 1,
				indices: [0, pattern.length - 1]
			};
		}
	})),
	def("include", "'", "", (pattern) => ({
		type: "include",
		search(text) {
			let location = 0;
			let index;
			const indices = [];
			const patternLen = pattern.length;
			if (!patternLen) return {
				isMatch: false,
				score: 1,
				indices
			};
			while ((index = text.indexOf(pattern, location)) > -1) {
				location = index + patternLen;
				indices.push([index, location - 1]);
			}
			const isMatch = !!indices.length;
			return {
				isMatch,
				score: isMatch ? 0 : 1,
				indices
			};
		}
	})),
	def("prefix-exact", "\\^", "", (pattern) => ({
		type: "prefix-exact",
		search(text) {
			const isMatch = text.startsWith(pattern);
			return {
				isMatch,
				score: isMatch ? 0 : 1,
				indices: [0, pattern.length - 1]
			};
		}
	})),
	def("inverse-prefix-exact", "!\\^", "", (pattern) => ({
		type: "inverse-prefix-exact",
		search(text) {
			const isMatch = !text.startsWith(pattern);
			return {
				isMatch,
				score: isMatch ? 0 : 1,
				indices: [0, text.length - 1]
			};
		}
	})),
	def("inverse-suffix-exact", "!", "\\$", (pattern) => ({
		type: "inverse-suffix-exact",
		search(text) {
			const isMatch = !text.endsWith(pattern);
			return {
				isMatch,
				score: isMatch ? 0 : 1,
				indices: [0, text.length - 1]
			};
		}
	})),
	def("suffix-exact", "", "\\$", (pattern) => ({
		type: "suffix-exact",
		search(text) {
			const isMatch = text.endsWith(pattern);
			return {
				isMatch,
				score: isMatch ? 0 : 1,
				indices: [text.length - pattern.length, text.length - 1]
			};
		}
	})),
	def("inverse-exact", "!", "", (pattern) => ({
		type: "inverse-exact",
		search(text) {
			const isMatch = text.indexOf(pattern) === -1;
			return {
				isMatch,
				score: isMatch ? 0 : 1,
				indices: [0, text.length - 1]
			};
		}
	})),
	def("fuzzy", "", "", (pattern, options = {}) => {
		const resolved = {};
		for (const key of FUZZY_OPTION_KEYS) resolved[key] = options[key] ?? Config[key];
		const bitap = new BitapSearch(pattern, resolved);
		return {
			type: "fuzzy",
			search(text) {
				return bitap.searchIn(text);
			}
		};
	})
];
const OPERATOR_TO_TYPE = {
	$fuzzy: "fuzzy",
	$eq: "exact",
	$contains: "include",
	$startsWith: "prefix-exact",
	$endsWith: "suffix-exact"
};
const NEGATED_TYPE = {
	$contains: "inverse-exact",
	$startsWith: "inverse-prefix-exact",
	$endsWith: "inverse-suffix-exact"
};
const DEF_BY_TYPE = {};
for (const def of matchers) DEF_BY_TYPE[def.type] = def;
function matcherDefForOperator(op) {
	const type = OPERATOR_TO_TYPE[op];
	return type ? DEF_BY_TYPE[type] : void 0;
}
function negatedMatcherDefForOperator(op) {
	const type = NEGATED_TYPE[op];
	return type ? DEF_BY_TYPE[type] : void 0;
}
function isKnownOperator(op) {
	return op in OPERATOR_TO_TYPE;
}

//#endregion
//#region src/search/extended/parseQuery.ts
const matchersLen = matchers.length;
const ESCAPED_PIPE = "\0";
const OR_TOKEN = "|";
function tokenize(pattern) {
	const tokens = [];
	const len = pattern.length;
	let i = 0;
	while (i < len) {
		while (i < len && pattern[i] === " ") i++;
		if (i >= len) break;
		let j = i;
		while (j < len && pattern[j] !== " " && pattern[j] !== "\"") j++;
		if (j < len && pattern[j] === "\"") {
			j++;
			while (j < len) {
				if (pattern[j] === "\"") {
					const next = j + 1;
					if (next >= len || pattern[next] === " ") {
						j++;
						break;
					}
					if (pattern[next] === "$" && (next + 1 >= len || pattern[next + 1] === " ")) {
						j += 2;
						break;
					}
				}
				j++;
			}
			tokens.push(pattern.substring(i, j));
			i = j;
		} else {
			while (j < len && pattern[j] !== " ") j++;
			tokens.push(pattern.substring(i, j));
			i = j;
		}
	}
	return tokens;
}
function getMatch(pattern, exp) {
	const matches = pattern.match(exp);
	return matches ? matches[1] : null;
}
function parseQuery(pattern, options = {}) {
	return pattern.replace(/\\\|/g, ESCAPED_PIPE).split(OR_TOKEN).map((item) => {
		const query = tokenize(item.replace(/\u0000/g, "|").trim()).filter((item) => item && !!item.trim());
		const results = [];
		for (let i = 0, len = query.length; i < len; i += 1) {
			const queryItem = query[i];
			let found = false;
			let idx = -1;
			while (!found && ++idx < matchersLen) {
				const def = matchers[idx];
				const token = getMatch(queryItem, def.multiRegex);
				if (token) {
					results.push(def.create(token, options));
					found = true;
				}
			}
			if (found) continue;
			idx = -1;
			while (++idx < matchersLen) {
				const def = matchers[idx];
				const token = getMatch(queryItem, def.singleRegex);
				if (token) {
					results.push(def.create(token, options));
					break;
				}
			}
		}
		return results;
	});
}

//#endregion
//#region src/search/extended/index.ts
const pickOptions = (options) => ({
	isCaseSensitive: options.isCaseSensitive,
	ignoreDiacritics: options.ignoreDiacritics,
	includeMatches: options.includeMatches
});
function normalizeValue(value, options) {
	value = options.isCaseSensitive ? value : value.toLowerCase();
	return options.ignoreDiacritics ? stripDiacritics(value) : value;
}
var ExtendedSearch = class ExtendedSearch {
	constructor(pattern, options = {}) {
		this.options = pickOptions(options);
		this.pattern = normalizeValue(pattern, options);
		this.query = parseQuery(this.pattern, options);
	}
	static fromMatchers(query, options = {}) {
		const search = Object.create(ExtendedSearch.prototype);
		search.options = pickOptions(options);
		search.pattern = "";
		search.query = query;
		return search;
	}
	static condition(_, options) {
		return options.useExtendedSearch;
	}
	searchIn(text) {
		const query = this.query;
		if (!query) return {
			isMatch: false,
			score: 1
		};
		const options = this.options;
		if (!options.isCaseSensitive) text = text.toLowerCase();
		if (options.ignoreDiacritics) text = stripDiacritics(text);
		for (let i = 0, qLen = query.length; i < qLen; i += 1) {
			const searchers = query[i];
			const pLen = searchers.length;
			const results = options.includeMatches && [];
			let totalScore = 0;
			let j = 0;
			for (; j < pLen; j += 1) {
				const res = searchers[j].search(text);
				if (!res.isMatch) break;
				totalScore += res.score;
				if (results) results.push(res);
			}
			if (pLen && j === pLen) {
				const result = {
					isMatch: true,
					score: totalScore / pLen
				};
				if (searchers.some((m) => isInverse(m.type))) result.hasInverse = true;
				if (results) {
					const allIndices = [];
					for (j = 0; j < pLen; j += 1) {
						const indices = results[j].indices;
						if (MULTI_MATCH_TYPES.has(searchers[j].type)) allIndices.push(...indices);
						else allIndices.push(indices);
					}
					result.indices = mergeIndices(allIndices);
				}
				return result;
			}
		}
		return {
			isMatch: false,
			score: 1
		};
	}
};

//#endregion
//#region src/core/register.ts
const registeredSearchers = [];
function register(...args) {
	registeredSearchers.push(...args);
}
let objectCompiler = null;
function registerObjectCompiler(fn) {
	objectCompiler = fn;
}
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
//#region src/search/token/index.ts
const MAX_MASK_TERMS = 31;
var TokenSearch = class {
	static condition(_, options) {
		return options.useTokenSearch;
	}
	constructor(pattern, options) {
		this.options = options;
		this.analyzer = createAnalyzer({
			isCaseSensitive: options.isCaseSensitive,
			ignoreDiacritics: options.ignoreDiacritics,
			tokenize: options.tokenize
		});
		const queryTerms = this.analyzer.tokenize(pattern);
		const { df, fieldCount } = options._invertedIndex;
		const { isCaseSensitive = Config.isCaseSensitive, ignoreDiacritics = Config.ignoreDiacritics } = options;
		const normalize = this.normalize = (text) => {
			text = isCaseSensitive ? text : text.toLowerCase();
			return ignoreDiacritics ? stripDiacritics(text) : text;
		};
		this.termSearchers = [];
		this.idfWeights = [];
		for (const term of queryTerms) {
			this.termSearchers.push(new BitapSearch(normalize(term), {
				...options,
				isCaseSensitive: true,
				ignoreDiacritics: false,
				ignoreLocation: true
			}));
			const docFreq = df.get(term) || 0;
			const idf = Math.log(1 + (fieldCount - docFreq + .5) / (docFreq + .5));
			this.idfWeights.push(idf);
		}
		this.combineAll = options.tokenMatch === "all";
		this.useMask = this.termSearchers.length <= 31;
	}
	searchIn(text) {
		text = this.normalize(text);
		const allIndices = [];
		let weightedScore = 0;
		let maxPossibleScore = 0;
		let matchedCount = 0;
		let matchedMask = 0;
		const matchedTerms = this.combineAll && !this.useMask ? /* @__PURE__ */ new Set() : null;
		for (let i = 0; i < this.termSearchers.length; i++) {
			const result = this.termSearchers[i].searchIn(text);
			const idf = this.idfWeights[i];
			maxPossibleScore += idf;
			if (result.isMatch) {
				matchedCount++;
				weightedScore += idf * (1 - result.score);
				if (result.indices) allIndices.push(...result.indices);
				if (this.combineAll) if (this.useMask) matchedMask |= 1 << i;
				else matchedTerms.add(i);
			}
		}
		if (matchedCount === 0) return {
			isMatch: false,
			score: 1
		};
		const normalized = maxPossibleScore > 0 ? 1 - weightedScore / maxPossibleScore : 0;
		const searchResult = {
			isMatch: true,
			score: Math.max(.001, normalized)
		};
		if (this.options.includeMatches && allIndices.length) searchResult.indices = mergeIndices(allIndices);
		if (this.combineAll) {
			if (this.useMask) searchResult.matchedMask = matchedMask;
			else searchResult.matchedTerms = matchedTerms;
			searchResult.termCount = this.termSearchers.length;
		}
		return searchResult;
	}
};

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
		if (this.options.useExtendedSearch && false);
		if (this.options.useTokenSearch && false);
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
		const expression = parse(query, this.options);
		const keys = this._normalizedKeys();
		const evaluate = (node, item, out) => {
			if (!("children" in node)) {
				const { keyId, searcher } = node;
				if (keyId === null) for (let k = 0; k < keys.length; k += 1) {
					const m = this._findMatches({
						key: keys[k],
						value: item[k],
						searcher
					});
					for (let j = 0; j < m.length; j += 1) out.push(m[j]);
				}
				else {
					const m = this._findMatches({
						key: this._keyStore.get(keyId),
						value: this._myIndex.getValueForItemAtKeyId(item, keyId),
						searcher
					});
					for (let j = 0; j < m.length; j += 1) out.push(m[j]);
				}
				return;
			}
			const { children, operator } = node;
			const start = out.length;
			for (let i = 0, len = children.length; i < len; i += 1) {
				const before = out.length;
				evaluate(children[i], item, out);
				if (out.length === before && operator === LogicalOperator.AND) {
					out.length = start;
					return;
				}
			}
		};
		const records = this._myIndex.records;
		const resultMap = /* @__PURE__ */ new Map();
		const results = [];
		records.forEach(({ $: item, i: idx }) => {
			if (isDefined(item)) {
				const matches = [];
				evaluate(expression, item, matches);
				if (matches.length) {
					const existing = resultMap.get(idx);
					if (existing) existing.matches.push(...matches);
					else {
						const result = {
							idx,
							item,
							matches
						};
						resultMap.set(idx, result);
						results.push(result);
					}
				}
			}
		});
		return results;
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
//#region src/search/extended/objectQuery.ts
const AND = "$and";
const OR = "$or";
const NOT = "$not";
function isPlainObject(value) {
	return isObjectLike(value) && !isArray(value);
}
function compileClause(clause, keyPath, options) {
	if (!isPlainObject(clause)) throw new Error(INVALID_FIELD_QUERY(keyPath, "each clause must be an operator object"));
	const ops = Object.keys(clause);
	if (!ops.length) throw new Error(INVALID_FIELD_QUERY(keyPath, "empty query"));
	const group = [];
	for (let i = 0; i < ops.length; i += 1) {
		const op = ops[i];
		if (op === AND || op === OR) throw new Error(INVALID_FIELD_QUERY(keyPath, `${op} cannot be nested`));
		let def;
		let raw;
		let valueOp = op;
		if (op === NOT) {
			const inner = clause[op];
			if (!isPlainObject(inner)) throw new Error(INVALID_FIELD_QUERY(keyPath, "$not must wrap an operator object"));
			const innerOps = Object.keys(inner);
			if (innerOps.length !== 1) throw new Error(INVALID_FIELD_QUERY(keyPath, "$not must wrap exactly one operator"));
			const innerOp = innerOps[0];
			if (innerOp === NOT) throw new Error(INVALID_FIELD_QUERY(keyPath, "$not cannot be nested"));
			if (innerOp === AND || innerOp === OR) throw new Error(INVALID_FIELD_QUERY(keyPath, `${innerOp} cannot be used inside $not`));
			if (!isKnownOperator(innerOp)) throw new Error(UNKNOWN_QUERY_OPERATOR(innerOp));
			def = negatedMatcherDefForOperator(innerOp);
			if (!def) throw new Error(INVALID_FIELD_QUERY(keyPath, `'${innerOp}' cannot be negated`));
			raw = inner[innerOp];
			valueOp = innerOp;
		} else {
			def = matcherDefForOperator(op);
			if (!def) throw new Error(UNKNOWN_QUERY_OPERATOR(op));
			raw = clause[op];
		}
		if (!isString(raw)) throw new Error(INVALID_FIELD_QUERY(keyPath, `value for '${valueOp}' must be a string`));
		const value = normalizeValue(raw, options);
		if (!value.length) throw new Error(EMPTY_QUERY_VALUE(valueOp, keyPath));
		group.push(def.create(value, options));
	}
	return group;
}
function compileAndGroup(arr, keyPath, options) {
	if (!isArray(arr) || !arr.length) throw new Error(INVALID_FIELD_QUERY(keyPath, "$and must be a non-empty array"));
	const group = [];
	for (let i = 0; i < arr.length; i += 1) {
		const matchers = compileClause(arr[i], keyPath, options);
		for (let j = 0; j < matchers.length; j += 1) group.push(matchers[j]);
	}
	return group;
}
function compileFieldQuery(fieldValue, keyPath, options) {
	if (!isPlainObject(fieldValue)) throw new Error(INVALID_FIELD_QUERY(keyPath, "field query must be an object"));
	const keys = Object.keys(fieldValue);
	if (!keys.length) throw new Error(INVALID_FIELD_QUERY(keyPath, "empty query"));
	const hasAnd = keys.indexOf(AND) !== -1;
	const hasOr = keys.indexOf(OR) !== -1;
	if (hasAnd || hasOr) {
		if (keys.length > 1) throw new Error(INVALID_FIELD_QUERY(keyPath, "operators cannot be mixed with $and/$or"));
		if (hasAnd) return [compileAndGroup(fieldValue[AND], keyPath, options)];
		const arr = fieldValue[OR];
		if (!isArray(arr) || !arr.length) throw new Error(INVALID_FIELD_QUERY(keyPath, "$or must be a non-empty array"));
		const groups = [];
		for (let i = 0; i < arr.length; i += 1) {
			const member = arr[i];
			if (isPlainObject(member) && Object.keys(member).indexOf(AND) !== -1) {
				if (Object.keys(member).length > 1) throw new Error(INVALID_FIELD_QUERY(keyPath, "$and cannot have siblings"));
				groups.push(compileAndGroup(member[AND], keyPath, options));
			} else groups.push(compileClause(member, keyPath, options));
		}
		return groups;
	}
	return [compileClause(fieldValue, keyPath, options)];
}
function compileObjectLeaf(fieldValue, keyPath, options) {
	return ExtendedSearch.fromMatchers(compileFieldQuery(fieldValue, keyPath, options), options);
}

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
register(ExtendedSearch);
registerObjectCompiler(compileObjectLeaf);
register(TokenSearch);
Fuse.use = function(...plugins) {
	plugins.forEach((plugin) => register(plugin));
};
var entry_default = Fuse;

//#endregion
module.exports = entry_default;