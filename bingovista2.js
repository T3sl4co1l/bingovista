/*
 *	bingovista2.js
 *	RW Bingo Board Viewer JS module
 *	(c) 2025 T3sl4co1l
 *	some more TODOs:
 *	- nudge around board view by a couple pixels to spread out rounding errors
 *	- board server to...basically URL-shorten?
 *	- ???
 *	- no profit, this is for free GDI
 *	- Streamline challenge parsing? compactify functions? or reduce to structures if possible?
 *	
 *	Stretchier goals:
 *	- Board editing, of any sort
 *	    * Drag and drop to move goals around
 *		* Make parameters editable
 *		* Port generator code from C#??
 */


/* * * Constants and Defaults * * */

/**
 *	List of sprite atlases, in order of precedence, highest to lowest.
 *	drawIcon() searches this list, in order, for an icon it needs.
 *	These are pre-loaded on startup from the named references, but unnamed or external
 *	references can be added by pushing (least priority), shifting (most), or inserting
 *	(anywhere) more entries.  Make sure `canv` contains a valid canvas of the sprite
 *	sheet, and `frames`, the collection of sprite names and coordinates.
 */
const atlases = [
	{ img: "bvicons.png",      txt: "bvicons.txt",      canv: undefined, frames: {} },	/**< anything not found below */
	{ img: "bingoicons.png",   txt: "bingoicons.txt",   canv: undefined, frames: {} },	/**< from Bingo Mode */
	{ img: "uispritesmsc.png", txt: "uispritesmsc.txt", canv: undefined, frames: {} },	/**< from DLC */
	{ img: "uiSprites.png",    txt: "uiSprites.txt",    canv: undefined, frames: {} },	/**< from base game */
];

/**
 *	Bingo square graphics, dimensions (in px) and other properties.
 *	Adjusted by parseText() to fit to canvas; see also: drawSquare calls 
 */
const square = {
	width: 85,
	height: 85,
	margin: 4,
	border: 2,
	color: "#ffffff",
	background: "#020204",
	font: "600 10pt \"Segoe UI\", sans-serif"
};

/**
 *	Maximum accepted value for Int32 challenge parameters. In-game default
 *	seems to be 500; binary format has a hard limit of 32767 (signed) or
 *	65535 (unsigned). Somewhere around 30k seems reasonable enough for a
 *	rounded value?
 */
const INT_MAX = 30000;
/** As INT_MAX, but for challenges *very* unlikely to need >1 byte */
const CHAR_MAX = 250;

/**	Supported mod version */
const VERSION_MAJOR = 1, VERSION_MINOR = 20;

/** Binary header length, bytes */
const HEADER_LENGTH = 21;
/** Binary goal length, bytes */
const GOAL_LENGTH = 3;

/** Used by getMapLink(); set to "" to disable */
var map_link_base = "https://noblecat57.github.io/map.html";


/* * * Global Variables * * */

/**
 *	The board.
 *	When not initialized / in gross error: undefined
 *	Else, this structure:
 *	{
 *		comments: <string>, 	//	"Untitled" by default
 *		character: <string>,	//	one of BingoEnum_CHARACTERS
 *		perks: <int>,       	//	bitmask of BingoEnum_PERKS
 *		shelter: <string>,  	//	starting shelter (blank if random)
 *		mods: [],           	//	TODO: list of modpacks (hash, name, reference?) in order of addition
 *		size: <int>,
 *		width: <int>,       	//	for now, width = height = size, but this allows
 *		height: <int>,      	//	support of rectangular grids in the future
 *		goals: [
 *			{
 *				name: "BingoGoalName", // name of CHALLENGE_DEFINITIONS root element which produced it
 *				category: <string>,
 *				items: [(<string>, ...)],
 *				values: [(<string>, ...)],
 *				description: <string>,
 *				error: <string>,
 *				comments: <string>,
 *				paint: [
 *					//	any of the following, in any order:
 *					{ type: "icon", value: <string>, scale: <number>, color: <HTMLColorString>, rotation: <number> },
 *					{ type: "icon", value: <string>, scale: <number>, color: <HTMLColorString>, rotation: <number>,
 *							background: { ..."icon" object... } },
 *					{ type: "break" },
 *					{ type: "text", value: <string>, color: <HTMLColorString> },
 *				],
 *				toBin: <Uint8Array>	//	binary format of goal
 *			},
 *
 *			( . . . )
 *
 *		],
 *		text: <string>,    	//	text format of whole board, including meta supported by current version (updated on refresh)
 *		toBin: <Uint8Array>	//	binary format of whole board, including meta and concatenated goals (updated on link)
 *	};
 */
var board;

/**
 *	Current selection cursor on the board (click on board, or focus board 
 *	and use arrow keys).  undefined: no selection; else: { row:, col: }
 */
var selected;


/** Flag to reveal full detail on otherwise-hidden challenges (e.g. Vista Points), and extended commentary */
var kibitzing = false;


/* * * Functions * * */

/* * * Event Listeners and Initialization * * */

document.addEventListener("DOMContentLoaded", function() {

	//	Initialize and decompress data
	square.color = RainWorldColors.Unity_white;
	addVistaPointsToCode(BingoEnum_VistaPoints);
	appendCHALLENGES();
	upgradeChallenges();

	//	Set up listeners
	setFakeButtonListeners("hdrshow", clickShowPerks);
	setFakeButtonListeners("clear", function(e) { setError("Clear."); document.getElementById("textbox").value = ""; });
	setFakeButtonListeners("parse", function(e) { setError("Parsed."); parseText(e); } );
	setFakeButtonListeners("maketext", refreshText);
	setFakeButtonListeners("copy", copyText);
	setFakeButtonListeners("send", openNewLink);
	setFakeButtonListeners("short", makeShortLink);
	document.getElementById("textbox").addEventListener("paste", pasteText);
	document.getElementById("boardcontainer").addEventListener("click", clickBoard);
	document.getElementById("boardcontainer").addEventListener("keydown", navSquares);
	document.getElementById("fileload")?.addEventListener("change", function() { doLoadFile(this.files) } );
	document.getElementById("kibitzing").addEventListener("input", toggleKibs);

	function setFakeButtonListeners(id, cb) {
		var el = document.getElementById(id);
		if (el === null) return;
		el.addEventListener("click", function(e) { cb(e); e.currentTarget.blur(); } );
		el.addEventListener("keydown", function(e) { emulateButton(e, id, cb) } );
	}

	var d = document.getElementById("droptarget");
	if (d !== null) {
		d.addEventListener("dragenter", dragEnterOver);
		d.addEventListener("dragover", dragEnterOver);
		d.addEventListener("dragleave", function(e) { this.style.backgroundColor = ""; } );
		d.addEventListener("drop", dragDrop);

		function dragEnterOver(e) {
			if (e.dataTransfer.types.includes("text/plain")
					|| e.dataTransfer.types.includes("Files")) {
				e.preventDefault();
				this.style.backgroundColor = "#686868";
			}
		}

	}

	//	Prepare atlases

	function loadImage(src, dest) {
		return new Promise(function (resolve, reject) {
			var img = document.createElement("img");
			img.addEventListener("load", function() {
				var canv = document.createElement("canvas");
				canv.width = img.naturalWidth; canv.height = img.naturalHeight;
				var ctx = canv.getContext("2d");
				ctx.drawImage(img, 0, 0);
				dest.canv = canv;
				//console.log("resolved: image load: " + src);
				resolve();
			});
			img.crossOrigin = "anonymous";
			img.addEventListener("error", () => reject( { message: "Error loading image " + src + "." } ) );
			img.src = src;
			//console.log("Promise executed: " + src + " image load");
		});
	}

	function loadJson(src, dest) {
		//console.log("loadJson: called, src: " + src);
		return fetch(src).then(function(response, reject) {
			if (!response.ok)
				return reject(new NetworkError("URL " + response.url + " error " + response.status + " " + response.statusText + "."));
			//console.log("resolved: " + src + " fetch");
			return response.text();
		}).catch((e) => {
			return Promise.reject(e);
		}).then((s) => {
			dest.frames = JSON.parse(s).frames;
		});
	}

	function loadClosure(s, d, f) {
		return f(s, d);
	}

	var loaders = [];
	for (var i = 0; i < atlases.length; i++) {
		loaders.push(loadClosure(atlases[i].img, atlases[i], loadImage));
	};
	for (var i = 0; i < atlases.length; i++) {
		loaders.push(loadClosure(atlases[i].txt, atlases[i], loadJson));
	};
	Promise.all(loaders).catch(function(e) {
		console.log("Promise.all(): failed to complete fetches. Error: " + e.message);
	}).finally(function() {

		//	resources loaded, final init
		var u = new URL(document.URL).searchParams;
		if (u.has("a")) {

			//	Plain text / ASCII string
			//	very inefficient, unlikely to be used, but provided for completeness
			document.getElementById("textbox").value = u.get("a");
			parseText();

		} else if (u.has("b")) {

			//	Binary string, base64 encoded
			try {
				//	Undo URL-safe escapes...
				var ar = base64uToBin(u.get("b"));
				try {
					board = binToString(ar);
				} catch (e) {
					setError("Error decoding board: " + e.message);
				}
				setHeaderFromBoard(board);
			} catch (e) {
				setError("Error parsing URL: " + e.message);
			}
			document.getElementById("textbox").value = board.text;

		} else if (u.has("q")) {

			//	Query, fetch from remote server to get board data
			var q = u.get("q");
			if (!validateQuery(q)) {
				console.log("Invalid query.");
				return;
			}
			var requrl = "https://" + "www.seventransistorlabs.com/bserv/BingoServer.dll?q=" + q;
			console.log("Requesting short key \"" + q + "\" from server...");
			fetch(new URL(requrl), { method: "GET" }
			).then(function(r) {
				//	Request succeeds
				console.log("Server accepted, status " + r.status + "...");
				return r.arrayBuffer();
			}, function(r) {
				//	Request failed (connection, invalid CORS, etc. error)
				setError("Error connecting to server.");
			} ).then(function(a) {
				//	success, arrayBuffer() complete
				console.log("...data received.");
				var ar = new Uint8Array(a.slice(1));
//				console.log("Assert: server response header 0: " + (new Uint8Array(a.slice(0, 1))[0]);
//				var s = "0x";
//				ar.forEach(a => s += a.toString(16) + ", 0x");
//				s = s.substring(0, s.length - 4);
//				console.log("Array: " + s);
				//	trim server response header
				try {
					board = binToString(ar);
				} catch (e) {
					setError("Error decoding board: " + e.message);
				}
				document.getElementById("textbox").value = board.text;

			} );

			function validateQuery(s) {
				if (s.length < 4 || s.length > 13) return false;
				for (var i = 0; i < s.length; i++) {
					var c = s.charCodeAt(i);
					if (c < '0'.charCodeAt(0) || c > 'z'.charCodeAt(0) ||
							(c > '9'.charCodeAt(0) && c < 'a'.charCodeAt(0)))
						return false;
				}
				return true;
			}

		}

	});

	//	Other housekeeping

	kibitzing = !!document.getElementById("kibitzing").checked;

});

/**
 *	Support viewer/creator header text fields, getting.
 */
function getElementContent(id) {
	var el = document.getElementById(id);
	if (el === null) return null;
	if (el.tagName === "INPUT")
		return el.value;
	else
		return el.innerHTML;
}

/**
 *	Support viewer/creator header text fields, setting.
 */
function setElementContent(id, v) {
	var el = document.getElementById(id);
	if (el === null) return null;
	if (el.tagName === "INPUT")
		el.value = v;
	else {
		while (el.childNodes.length) el.removeChild(el.childNodes[0]);
		el.appendChild(document.createTextNode(v));
	}
}

/**
 *	"Fake" button, keyboard press input event listener.
 *	@param e       received event
 *	@param target  string, target element's id
 *	@param cb      callback function (e is passed as parameter)
 */
function emulateButton(e, target, cb) {
	if (target === e.target.id) {
		if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
			e.preventDefault();
			e.target.blur();
			cb(e);
		}
	}
}

/**
 *	Set header table from board data as returned from binToString.
 */
function setHeaderFromBoard(b) {
	var el = document.getElementById("hdrttl");
	while (el.childNodes.length) el.removeChild(el.childNodes[0]);
	el.appendChild(document.createTextNode(b.comments));
	el = document.getElementById("hdrsize");
	while (el.childNodes.length) el.removeChild(el.childNodes[0]);
	el.appendChild(document.createTextNode(String(b.width) + " x " + String(b.height)));
	el = document.getElementById("hdrchar");
	while (el.childNodes.length) el.removeChild(el.childNodes[0]);
	el.appendChild(document.createTextNode(b.character || "Any"));
	el = document.getElementById("hdrshel");
	while (el.childNodes.length) el.removeChild(el.childNodes[0]);
	el.appendChild(document.createTextNode(b.shelter || "random"));
	perksToChecksList(b.perks);
	addModsToHeader(b.mods);
}

/**
 *	Sets a message in the error box.
 */
function setError(s) {
	var mb = document.getElementById("errorbox");
	while (mb.childNodes.length) mb.removeChild(mb.childNodes[0]);
	mb.appendChild(document.createTextNode(s));
}

/**
 *	Data dropped onto load widget.
 *	Used on CREATE page.
 */
function dragDrop(e) {
	e.preventDefault();
	this.style.backgroundColor = "";
	var d = e.dataTransfer;
	setError("");
	if (d.types.includes("Files")) {
		doLoadFile(d.files);
	} else {
		var s;
		for (var i = 0; i < d.items.length; i++) {
			if (d.items[i].type.match("^text/plain")) {
				d.items[i].getAsString(function(s) {
					var p = document.getElementById("textbox").value === "";
					document.getElementById("textbox").value = s;
					if (p) parseText();
				});
				return;
			}
		}
		setError("Please drop a text file.");
	}
}

/**
 *	File loaded.
 *	Used on CREATE page.
 */
function doLoadFile(files) {
	for (var i = 0; i < files.length; i++) {
		if (files[i].type.match("^text/plain")) {
			var fr = new FileReader();
			fr.onload = function() {
				document.getElementById("textbox").value = this.result;
				parseText();
			};
			fr.onerror = function(e) {
				setError("File read error: " + e.message);
			};
			fr.readAsText(files[i]);
			return;
		}
	}
	setError("Please select a text file.");
}

/**
 *	Parse Text button pressed.
 *	Used on CREATE page.
 */
function parseText(e) {
	var s = document.getElementById("textbox").value;
	s = s.trim().replace(/\s*bChG\s*/g, "bChG");
	var goals = s.split(/bChG/);
	var size = Math.ceil(Math.sqrt(goals.length));
	if (board === undefined) {
		board = {
			comments: "Untitled",
			character: "Any",
			perks: 0,
			shelter: "",
			mods: [],
			size: size,
			width: size,
			height: size,
			goals: [],
			toBin: undefined
		};
	} else {
		//	Board already exists, parse meta from the document
		if (document.getElementById("hdrttl") !== null)
			board.comments = document.getElementById("hdrttl").innerText || "Untitled";
		if (document.getElementById("hdrchar") !== null)
			board.character = document.getElementById("hdrchar").innerText;
		if (document.getElementById("hdrshel") !== null) {
			board.shelter = document.getElementById("hdrshel").innerText;
			if (board.shelter === "random") board.shelter = "";
		}
		for (var i = 0, el; i < Object.values(BingoEnum_EXPFLAGS).length; i++) {
			el = document.getElementById("perkscheck" + String(i));
			if (el !== null) {
				if (el.checked)
					board.perks |= Object.values(BingoEnum_EXPFLAGS)[i];
				else
					board.perks &= ~Object.values(BingoEnum_EXPFLAGS)[i];
			} else
				break;
		}
		board.goals = [];
		board.size = size; board.width = size; board.height = size;
	}

	//	Detect board version:
	//	assertion: no challenge names are shorter than 14 chars (true as of 0.90)
	//	assertion: no character names are longer than 10 chars (true of base game + Downpour)
	//	0.90+: character prefix, ";" delimited --> check within first 12 chars
	//	0.86: character prefix, "_" delimited --> check within first 12 chars
	//	0.85: no prefix, gonzo right into the goal list --> first token (to "~") is valid goal name or error
	if (goals[0].search(/[A-Za-z]{1,12}[_;]/) == 0) {
		//	Seems 0.86 or 0.90, find which
		if (goals[0].indexOf(";") > 0) {
			board.version = "0.90";
			board.character = goals[0].substring(0, goals[0].indexOf(";"));
			goals[0] = goals[0].substring(goals[0].indexOf(";") + 1);
		} else if (goals[0].indexOf("_") > 0) {
			board.version = "0.86";
			board.character = goals[0].substring(0, goals[0].indexOf("_"));
			goals[0] = goals[0].substring(goals[0].indexOf("_") + 1);
		}
		board.character = BingoEnum_CharToDisplayText[board.character] || "Any";
	} else {
		board.version = "0.85";
	}

	for (var i = 0; i < goals.length; i++) {
		var type, desc;
		if (goals[i].search("~") > 0 && goals[i].search("><") > 0) {
			[type, desc] = goals[i].split("~");
			desc = desc.split(/></);
			if (type === "BingoMoonCloak") type = "BingoMoonCloakChallenge";	//	1.08 hack
			if (CHALLENGES[type] !== undefined) {
				try {
					board.goals.push(CHALLENGES[type](desc));
				} catch (er) {
					board.goals.push(CHALLENGES["BingoChallenge"]( [
						"Error: " + er.message + "; descriptor: " + desc.join("><") ] ));
				}
			} else {
				board.goals.push(CHALLENGES["BingoChallenge"](["Error: unknown type: [" + type + "," + desc.join(",") + "]"]));
			}
		} else {
			board.goals.push(CHALLENGES["BingoChallenge"](["Error extracting goal: " + goals[i]]));
		}
	}
	if (goals.length == 0)
		board.goals.push(CHALLENGES["BingoChallenge"]("blank"));

	function defaultGoal(t, d) {
		return {
			name: "BingoChallenge",
			category: t,
			items: [],
			values: [],
			description: "Unknown goal. Descriptor: " + d.join("><"),
			comments: "",
			paint: [
				{ type: "text", value: "∅", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 }
			],
			toBin: new Uint8Array([challengeValue("BingoChallenge"), 0, 0])
		};
	}

	if (selected !== undefined) {
		//	See if we can re-select the same square (position) in the new board
		if (selected.row < board.height && selected.col < board.width) {
			selectSquare(selected.col, selected.row);
		} else {
			selected = undefined;
		}
	}
	if (selected === undefined)
		selectSquare(-1, -1);

	//	Adjust graphical dimensions based on canvas and board sizes
	var canv = document.getElementById("board");
	square.margin = Math.max(Math.round((canv.width + canv.height) * 2 / ((board.width + board.height) * 91)) * 2, 2);
	square.width = Math.round((canv.width / board.width) - square.margin - square.border);
	square.height = Math.round((canv.height / board.height) - square.margin - square.border);

	//	Redraw the board
	var ctx = document.getElementById("board").getContext("2d");
	ctx.fillStyle = square.background;
	ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
	for (var i = 0; i < board.goals.length; i++) {
		drawSquare(ctx, board.goals[i],
				Math.floor(i / board.height) * (square.width + square.margin + square.border)
					+ (square.border + square.margin) / 2,
				(i % board.height) * (square.height + square.margin + square.border)
					+ (square.border + square.margin) / 2,
				square);
	}

	//	Fill meta table with board info
	setHeaderFromBoard(board);

	//	prepare board binary encoding
	board.toBin = boardToBin(board);

	if (selected !== undefined)
		selectSquare(selected.col, selected.row);

}

/**
 *	Refresh text button pressed.
 */
function refreshText(e) {
	setError("Feature not implemented yet.");
}

/**
 *	Kibitzing check toggled.
 */
function toggleKibs(e) {
	kibitzing = !!document.getElementById("kibitzing").checked;
	if (selected !== undefined)
		selectSquare(selected.col, selected.row);
}

/**
 *	Pressed "link" button.
 */
function openNewLink(e) {
	var u = document.URL;
	u = u.substring(0, u.lastIndexOf("/")) + "/view.html?b="
			+ binToBase64u(board.toBin);
	var a = document.createElement("a");
	a.target = "_blank";
	a.href = u;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
}

/**
 *	Pressed "Shorten" button.
 */
function makeShortLink(e) {
	setError("Feature not implemented yet.");
}

/**
 *	Pasted to textbox.
 */
function pasteText(e) {
	//	If the box was empty, auto parse.
	//	Otherwise, editing is probably being done, don't bother the user
	if (document.getElementById("textbox").value === "") {
		setError("Parsed pasted text.");
		setTimeout(parseText, 10);
	}
}

/**
 *	Clicked on Copy.
 */
function copyText(e) {
	navigator.clipboard.writeText(document.getElementById("textbox").value);
	setError("Text copied to clipboard.");
}

/**
 *	Clicked on Show/Hide.
 */
function clickShowPerks(e) {
	var elem = document.getElementById("hdrperks");
	if (elem.style.display === "none")
		elem.style.display = "initial";
	else
		elem.style.display = "none";
}

/**
 *	Clicked on canvas.
 */
function clickBoard(e) {
	if (board !== undefined) {
		var rect = document.getElementById("boardcontainer").getBoundingClientRect();
		var x = Math.floor(e.clientX - Math.round(rect.left)) - (square.border + square.margin) / 2;
		var y = Math.floor(e.clientY - Math.round(rect.top )) - (square.border + square.margin) / 2;
		var sqWidth = square.width + square.margin + square.border;
		var sqHeight = square.height + square.margin + square.border;
		var col = Math.floor(x / sqWidth);
		var row = Math.floor(y / sqHeight);
		if (x >= 0 && y >= 0 && (x % sqWidth) < (sqWidth - square.margin)
				&& (y % sqHeight) < (sqHeight - square.margin)) {
			selectSquare(col, row);
		} else {
			selectSquare(-1, -1);
		}
	}
}

/**
 *	Select the square at (col, row) to show details of.
 *	If either argument is out of range, clears the selection instead.
 */
function selectSquare(col, row) {
	var el = document.getElementById("desctxt");
	var ctx = document.getElementById("square").getContext("2d");
	if (row < 0 || col < 0 || row >= board.height || col >= board.width) {
		clearDescription();
		return;
	}
	var goal = board.goals[row + col * board.height];
	if (goal === undefined) {
		clearDescription();
		return;
	}
	selected = { row: row, col: col };
	ctx.fillStyle = square.background;
	ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
	var size = {}; Object.assign(size, square);
	size.margin = 4;
	size.width = ctx.canvas.width - size.margin - size.border;
	size.height = ctx.canvas.height - size.margin - size.border;
	drawSquare(ctx, goal, (size.border + size.margin) / 2, (size.border + size.margin) / 2, size);

	while (el.childNodes.length) el.removeChild(el.childNodes[0]);
	var el2 = document.createElement("div"); el2.setAttribute("class", "descch");
	el2.appendChild(document.createTextNode("Challenge: " + goal.category));
	el.appendChild(el2);
	el2 = document.createElement("div"); el2.setAttribute("class", "descdesc");
	//	If content is "trusted", let it use HTML; else, escape it because it contains board text that's illegal HTML
	if (goal.name === "BingoChallenge")
		el2.appendChild(document.createTextNode(goal.description));
	else
		el2.innerHTML = goal.description;
	el.appendChild(el2);
	el2 = document.createElement("table"); el2.setAttribute("class", "desclist");
	var el3 = document.createElement("thead");
	var tr = document.createElement("tr");
	var td = document.createElement("td"); td.appendChild(document.createTextNode("Parameter")); tr.appendChild(td);
	td = document.createElement("td"); td.appendChild(document.createTextNode("Value")); tr.appendChild(td);
	el3.appendChild(tr);
	el3 = document.createElement("tbody");
	for (var i = 0; i < goal.items.length && i < goal.values.length; i++) {
		if (goal.items[i].length > 0) {
			tr = document.createElement("tr");
			td = document.createElement("td"); td.appendChild(document.createTextNode(goal.items[i]));
			tr.appendChild(td);
			td = document.createElement("td"); td.appendChild(document.createTextNode(goal.values[i]));
			td.style.wordWrap = "anywhere";
			tr.appendChild(td);
			el3.appendChild(tr);
		}
	}
	el2.appendChild(el3);
	el.appendChild(el2);

	if (kibitzing && goal.comments.length > 0) {
		el2 = document.createElement("div"); el2.setAttribute("class", "desccomm");
		el2.innerHTML = goal.comments;
		el.appendChild(el2);
	}

	//	position cursor
	var curSty = document.getElementById("cursor").style;
	curSty.width  = String(square.width  + square.border - 4) + "px";
	curSty.height = String(square.height + square.border - 4) + "px";
	curSty.left = String(square.margin / 2 - 0 + col * (square.width + square.margin + square.border)) + "px";
	curSty.top  = String(square.margin / 2 - 0 + row * (square.height + square.margin + square.border)) + "px";
	curSty.display = "initial";
	return;

	function clearDescription() {
		selected = undefined;
		ctx.fillStyle = square.background;
		ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
		while (el.childNodes.length) el.removeChild(el.childNodes[0]);
		el.appendChild(document.createTextNode("Select a square to view details."));
		document.getElementById("cursor").style.display = "none";
	}

	/** maybe this is why I should build by objects instead of String into HTML directly? */
	function escapeHTML(s) {
		var el = document.createElement("div");
		el.appendChild(document.createTextNode(s));
		return el.innerHTML;
	}
}

/**
 *	Key input to board container; pare down to arrow keys for navigating squares
 */
function navSquares(e) {
	if (board !== undefined && ["board", "boardcontainer", "cursor"].includes(e.target.id)) {
		var dRow = 0, dCol = 0;
		if (e.key === "Up"    || e.key === "ArrowUp"   ) dRow = -1;
		if (e.key === "Down"  || e.key === "ArrowDown" ) dRow = 1;
		if (e.key === "Left"  || e.key === "ArrowLeft" ) dCol = -1;
		if (e.key === "Right" || e.key === "ArrowRight") dCol = 1;
		if (dRow || dCol) {
			e.preventDefault();
			var col = 0, row = 0;
			if (selected !== undefined) {
				col = selected.col;
				row = selected.row;
			}
			row += dRow; col += dCol;
			if (row < 0) row += board.height;
			if (row >= board.height) row -= board.height;
			if (col < 0) col += board.width;
			if (col >= board.width) col -= board.width;
			selectSquare(col, row);
		}
	}
}

/**
 *	Draw a challenge square to the specified canvas at the specified location (top-left corner).
 */
function drawSquare(ctx, goal, x, y, size) {
	ctx.beginPath();
	ctx.strokeStyle = size.color;
	ctx.lineWidth = size.border;
	ctx.lineCap = "butt";
	ctx.moveTo(x, y);
	ctx.lineTo(x + size.width, y);
	ctx.moveTo(x + size.width, y);
	ctx.lineTo(x + size.width, y + size.height);
	ctx.moveTo(x + size.width, y + size.height);
	ctx.lineTo(x, y + size.height);
	ctx.moveTo(x, y + size.height);
	ctx.lineTo(x, y);
	ctx.stroke();
	ctx.imageSmoothingEnabled = "false";
	var lines = [], thisLine = [];
	for (var i = 0; i < goal.paint.length; i++) {
		if (goal.paint[i].type === "break") {
			lines.push(thisLine);
			thisLine = [];
		} else {
			thisLine.push(goal.paint[i]);
		}
	}
	if (thisLine.length) lines.push(thisLine);
	ctx.font = size.font;
	ctx.textAlign = "center"; ctx.textBaseline = "middle";
	var xBase, yBase;
	for (var i = 0; i < lines.length; i++) {
		if (lines.length == 2)	//	not sure why this special case, but it seems to better match how the mod has it
			yBase = y + size.border / 2 + (size.height - size.border) * (i + 1) / (lines.length + 1);
		else
			yBase = y + size.border / 2 + (size.height - size.border) * (i + 0.5) / lines.length;
		yBase = Math.round(yBase);
		for (var j = 0; j < lines[i].length; j++) {
			if (lines[i].length == 2)
				xBase = x + size.border / 2 + (size.width - size.border) * (j + 1) / (lines[i].length + 1);
			else
				xBase = x + size.border / 2 + (size.width - size.border) * (j + 0.5) / lines[i].length;
			xBase = Math.round(xBase);
			if (lines[i][j].type === "icon") {
				if (lines[i][j].background !== undefined && lines[i][j].background.type === "icon") {
					drawIcon(ctx, lines[i][j].background.value, xBase, yBase, lines[i][j].background.color, lines[i][j].background.scale, lines[i][j].background.rotation);
				}
				drawIcon(ctx, lines[i][j].value, xBase, yBase, lines[i][j].color, lines[i][j].scale, lines[i][j].rotation);
			} else if (lines[i][j].type === "text") {
				ctx.fillStyle = lines[i][j].color;
				ctx.fillText(lines[i][j].value, xBase, yBase);
			} else {
				//	unimplemented
				drawIcon(ctx, "Futile_White", xBase, yBase, RainWorldColors.Unity_white, lines[i][j].scale || 1, lines[i][j].rotation || 0);
			}
		}
	}
}

/**
 *	Draws the specified icon to the canvas, at location (on center).
 */
function drawIcon(ctx, icon, x, y, colr, scale, rot) {
	ctx.translate(x, y);
	ctx.rotate(rot * Math.PI / 180);
	ctx.scale(scale, scale);
	var spri, src;
	if (icon === undefined) {
		//	Doesn't exist, draw dummy square
		ctx.fillStyle = colr;
		ctx.fillRect(-8, -8, 16, 16);
	} else {
		//	Search atlases for sprite
		for (var i = 0; i < atlases.length; i++) {
			spri = atlases[i].frames[icon + ".png"];
			src = atlases[i].canv;
			if (spri !== undefined)
				break;
		}
		if (spri === undefined) {
			//	Can't find it, draw dummy square
			ctx.fillStyle = colr;
			ctx.fillRect(-8, -8, 16, 16);
		} else {
			var composite = document.createElement("canvas");
			composite.width = spri.frame.w; composite.height = spri.frame.h;
			var ctx2 = composite.getContext("2d");
			ctx2.globalCompositeOperation = "source-over";
			ctx2.clearRect(0, 0, spri.frame.w, spri.frame.h);
			ctx2.drawImage(src, spri.frame.x, spri.frame.y, spri.frame.w, spri.frame.h,
					0, 0, spri.frame.w, spri.frame.h);
			ctx2.globalCompositeOperation = "multiply";
			ctx2.fillStyle = colr;
			ctx2.fillRect(0, 0, spri.frame.w, spri.frame.h);
			ctx2.globalCompositeOperation = "destination-in";
			ctx2.drawImage(src, spri.frame.x, spri.frame.y, spri.frame.w, spri.frame.h,
					0, 0, spri.frame.w, spri.frame.h);
			ctx.imageSmoothingEnabled = false;
			ctx.drawImage(composite, 0, 0, spri.frame.w, spri.frame.h,
					Math.round(-spri.frame.w / 2), Math.round(-spri.frame.h / 2), spri.frame.w, spri.frame.h);
		}
	}
	ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/**
 *	Converts a validated board in text, to binary format.
 *	The validated board contains toBin snippets; these are
 *	concatenated, and a header is added.
 *	@param b board structure (see global `board`)
 */
function boardToBin(b) {
	var e = new TextEncoder();
	var hdr = new Uint8Array(HEADER_LENGTH);
	var comm = e.encode(b.comments + "\u0000");
	var shelter = e.encode(b.shelter + "\u0000");
	var mods = modsToArray(b.mods);
	//	struct bingo_header_s {
	//	uint32_t magicNumber;
	applyLong(hdr, 0, 0x69427752); 	//	"RwBi" = Rain World BIngo board
	//	uint8_t version_major; uint8_t version_minor;
	hdr[4] = VERSION_MAJOR; hdr[5] = VERSION_MINOR;
	//	uint8_t boardWidth; uint8_t boardHeight;
	hdr[6] = b.width; hdr[7] = b.height;
	//	uint8_t character;
	hdr[8] = Object.values(BingoEnum_CharToDisplayText).indexOf(b.character) + 1;
	//	uint16_t shelter;
	applyShort(hdr, 9, hdr.length + comm.length);
	//	uint32_t perks;
	applyLong(hdr, 11, b.perks);
	//	uint16_t goals;
	applyShort(hdr, 15, hdr.length + comm.length + shelter.length + mods.length);
	//	uint16_t mods;
	applyShort(hdr, 17, ((mods.length > 0) ? hdr.length + comm.length + shelter.length : 0));
	//	uint16_t reserved;
	applyShort(hdr, 19, 0);
	//	uint8_t[] comments;
	//	};
	var gLen = 0;
	for (var i = 0; i < b.goals.length; i++) {
		gLen += b.goals[i].toBin.length;
	}
	gLen += hdr.length + comm.length + shelter.length + mods.length;
	gLen = Math.ceil(gLen / 3) * 3;	//	round up to pad with zeroes; no effect on board, removes base64 padding
	var r = new Uint8Array(gLen);
	var offs = 0;
	r.set(hdr, offs); offs += hdr.length;
	r.set(comm, offs); offs += comm.length;
	r.set(shelter, offs); offs += shelter.length;
	r.set(mods, offs); offs += mods.length;
	for (var i = 0; i < b.goals.length; i++) {
		r.set(b.goals[i].toBin, offs); offs += b.goals[i].toBin.length;
	}

	return r;

	function modsToArray(m) {
		var a = [];
		var enc = new TextEncoder();
		for (var i = 0; i < m.length; i++) {
			//	serialize mod entries here
		}
		return new Uint8Array(a);
	}

}

/**
 *	Converts a board in binary format, to a fully populated board structure.
 *	Output properties:
 *		comments: comment or title string
 *		character: character/campaign (from BingoEnum_CharToDisplayText)
 *		perks: bitmask of perks and other options (see BingoEnum_EXPFLAGS)
 *		shelter: starting shelter (or "random")
 *		mods: array of mod objects (not implemented yet)
 *		size, width, height: board dimensions (for now, square, so these are equal)
 *		text: the (in-game) board text string
 *		goals: array of CHALLENGES output objects
 *		toBin: the original binary code
 */
function binToBoard(a) {
	//	Minimum size to read full header
	if (a.length < HEADER_LENGTH)
		throw new TypeError("binToBoard: insufficient data, found " + String(a.length) + ", expected: " + String(HEADER_LENGTH) + " bytes");
	//	uint32_t magicNumber;
	if (readLong(a, 0) != 0x69427752)
		throw new TypeError("binToBoard: unknown magic number: 0x" + readLong(a, 0).toString(16) + ", expected: 0x69427752");
	//	(6, 7) uint8_t boardWidth; uint8_t boardHeight;
	var b = {
		comments: "Untitled",
		character: "Any",
		perks: 0,
		shelter: "",
		mods: [],
		size: a[6],	//	for now, width = height = size, so the source of this assignment doesn't matter
		width: a[6],
		height: a[7],
		text: "",
		goals: [],
		toBin: a
	};
	var d = new TextDecoder;
	//	uint8_t version_major; uint8_t version_minor;
	if (((a[4] << 8) + a[5]) > (VERSION_MAJOR << 8) + VERSION_MINOR)
		setError("Warning: board version " + String(a[4]) + "." + String(a[5])
				+ " is newer than viewer v" + String(VERSION_MAJOR) + "." + String(VERSION_MINOR)
				+ "; some goals or features may be unsupported.");
	//	uint8_t character;
	b.character = (a[8] == 0) ? "Any" : Object.values(BingoEnum_CharToDisplayText)[a[8] - 1];
	b.text += (a[8] == 0) ? "Any" : Object.keys(BingoEnum_CharToDisplayText)[a[8] - 1] + ";";
	//	uint16_t shelter;
	var ptr = readShort(a, 9);
	if (ptr > 0) {
		if (ptr >= a.length)
			throw new TypeError("binToBoard: shelter pointer 0x" + ptr.toString(16) + " out of bounds");
		if (a.indexOf(0, ptr) < 0)
			throw new TypeError("binToBoard: shelter missing terminator");
		b.shelter = d.decode(a.subarray(ptr, a.indexOf(0, ptr)));
	}
	//	uint32_t perks;
	b.perks = readLong(a, 11);
	//	uint16_t mods;
	ptr = readShort(a, 17);
	if (ptr > 0) {
		if (ptr >= a.length)
			throw new TypeError("binToBoard: mods pointer 0x" + ptr.toString(16) + " out of bounds");
		b.mods = readMods(a, ptr);
	}
	//	uint16_t reserved;
	if (readShort(a, 19) != 0)
		throw new TypeError("binToBoard: reserved: 0x" + readShort(a, 19).toString(16) + ", expected: 0x0");
	//	(21) uint8_t[] comments;
	if (a.indexOf(0, HEADER_LENGTH) < 0)
		throw new TypeError("binToBoard: comments missing terminator");
	b.comments = d.decode(a.subarray(HEADER_LENGTH, a.indexOf(0, HEADER_LENGTH)));

	//	uint16_t goals;
	ptr = readShort(a, 15);
	var goal, type, desc;
	for (var i = 0; i < b.width * b.height && ptr < a.length; i++) {
		try {
			goal = binGoalToAbstract(a.subarray(ptr, ptr + a[ptr + 2] + GOAL_LENGTH));
		} catch (er) {
			goal = "BingoChallenge~Error: " + er.message + "><";
		}
		b.text += goal + "bChG";
		//[type, desc] = goal.split("~");
		//desc = desc.split(/></);
		//board.goals.push(CHALLENGES[type](desc));
		ptr += GOAL_LENGTH + a[ptr + 2];
	}
	b.text = b.text.replace(/bChG$/, "");

	return b;

	function readMods(c, offs) {
		return [];
	}

}

/**
 *	Challenge classes; used by parseText().
 *	From Bingomod decomp/source, with some customization (particularly across
 *	versions).
 *
 *	Assumption: global `board` variable's header properties have been set, and can
 *	be read at this point.
 *
 *	Adding new challenges:
 *	Append at the bottom. Yeah, they're not going to be alphabetical order anymore.
 *	Order is used by challengeValue, and thus translate names to binary identifier;
 *	to minimize changes in binary format, preserve existing ordering when possible.
 *
 *	Modifying existing challenges:
 *	Where possible, preserve compatibility between formats, auto-detect differences,
 *	or use board.version to select method when not otherwise suitable.
 *	Reference hacks for example: BingoDamageChallenge / BingoDamageExChallenge,
 *	BingoTameChallenge and BingoTameExChallenge (and respective entries in
 *	CHALLENGE_DEFINITIONS).
 *
 *	Maintain sync between CHALLENGES, CHALLENGE_DEFINITIONS and
 *	BingoEnum_CHALLENGES.
 */
const CHALLENGES = {
	BingoChallenge: function(desc) {
		const thisname = "BingoChallenge";
		var params = textGoalToAbstract(thisname + "~" + desc.join("><"));
		return {
			name: params.GoalName,
			category: params.GoalCategory,
			error: params.error,
			items: params.paramList,
			values: params.valueList,
			description: params.GoalDesc(params),
			comments: params.GoalComments(params),
			paint: params.GoalPaint(params),
			toBin: params.BinEncode(params)
		};
/*
		//	Keep as template and default; behavior is as a zero-terminated string container
		desc[0] = desc[0].substring(0, 255);
		var b = new Uint8Array(258);
		b[0] = challengeValue(thisname);
		var enc = new TextEncoder().encode(desc[0]);
		enc = enc.subarray(0, 255);
		b.set(enc, 3);
		b[2] = enc.length;
		return {
			name: thisname,
			category: "Empty challenge class",
			items: [],	///< items and values arrays must have equal length
			values: [],
			description: desc[0],	///< HTML allowed (for other than base name === "BingoChallenge" objects)
			comments: "",	///< HTML allowed
			paint: [
				{ type: "text", value: "∅", color: RainWorldColors.Unity_white }
			],
			toBin: b.subarray(0, enc.length + GOAL_LENGTH)
		};
*/
	},
	BingoAchievementChallenge: function(desc) {
		const thisname = "BingoAchievementChallenge";
		var params = textGoalToAbstract(thisname + "~" + desc.join("><"));
		return {
			name: params.GoalName,
			category: params.GoalCategory,
			error: params.error,
			items: params.paramList,
			values: params.valueList,
			description: params.GoalDesc(params),
			comments: params.GoalComments(params),
			paint: params.GoalPaint(params),
			toBin: params.BinEncode(params)
		};
/*
		//	assert: desc of format ["System.String|Traveller|Passage|0|passage", "0", "0"]
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Passage", , "passage"], "goal selection");
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "passage");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Obtaining Passages",
			items: ["Passage"],
			values: [items[1]],
			description: "Earn " + (passageToDisplayNameMap[items[1]] || "unknown") + " passage.",
			comments: "",
			paint: [
				{ type: "icon", value: "smallEmptyCircle", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: items[1] + "A", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "smallEmptyCircle", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
*/
	},
	BingoAllRegionsExcept: function(desc) {
		const thisname = "BingoAllRegionsExcept";
		//	desc of format ["System.String|UW|Region|0|regionsreal", "SU|HI|DS|CC|GW|SH|VS|LM|SI|LF|UW|SS|SB|LC", "0", "System.Int32|13|Amount|1|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 6, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Region", , "regionsreal"], "region selection");
		var r = (regionCodeToDisplayName[items[1]] || "") + " / " + (regionCodeToDisplayNameSaint[items[1]] || "");
		r = r.replace(/^\s\/\s|\s\/\s$/g, "");
		if (r === "")
			throw new TypeError(thisname + ": error, region \"" + items[1] + "\" not found in regionCodeToDisplayName[]");
		var amt = parseInt(desc[2]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + desc[2] + "\" not a number or out of range");
		var amt2 = parseInt(desc[3]);
		if (isNaN(amt2)) {
			//	0.85: desc[3] is just a number; 0.90: uses SettingBox, try parsing it that way
			var amounts = checkSettingbox(thisname, desc[3], ["System.Int32", , "Amount", , "NULL"], "amount");
			amt2 = parseInt(amounts[1]); desc[3] = amounts[1];
		}
		amt2 = Math.min(amt2, amt + CHAR_MAX);
		if (isNaN(amt2) || amt2 < 0 || amt2 > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + desc[3] + "\" not a number or SettingBox, or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "regionsreal");
		b[4] = amt2 - amt;
		desc[1].split("|").forEach(s => b.push(enumToValue(s, "regionsreal")) );
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Entering regions while never visiting one",
			items: [items[2], "To do", "Progress", "Total"],
			values: [items[1], desc[1], String(amt), String(amt2)],
			description: "Enter " + String(amt2 - amt) + " regions that are not " + r + ".",
			comments: "This challenge is potentially quite customizable; only regions in the list need to be entered. Normally, the list is populated with all campaign story regions (i.e. corresponding Wanderer pips), so that progress can be checked on the sheltering screen. All that matters towards completion, is Progress equaling Total; thus we can set a lower bar and play a \"The Wanderer\"-lite; or we could set a specific collection of regions to enter, to entice players towards them. Downside: the latter functionality is not currently supported in-game: the region list is something of a mystery unless viewed and manually tracked. (This goal generates with all regions listed, so that all will contribute towards the goal.)",
			paint: [
				{ type: "icon", value: "TravellerA", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "buttonCrossA", scale: 1, color: RainWorldColors.Unity_red, rotation: 0 },
				{ type: "text", value: items[1], color: RainWorldColors.Unity_white },
				{ type: "break" },
				{ type: "text", value: "[" + String(amt) + "/" + String(amt2) + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoBombTollChallenge: function(desc) {
		const thisname = "BingoBombTollChallenge";
		//	desc of format ["System.String|gw_c05|Scavenger Toll|1|tolls", "System.Boolean|false|Pass the Toll|0|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Scavenger Toll", , "tolls"], "toll selection");
		if (!BingoEnum_BombableOutposts.includes(items[1]))
			throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in BingoEnum_BombableOutposts[]");
		var pass = checkSettingbox(thisname, desc[1], ["System.Boolean", , "Pass the Toll", , "NULL"], "pass toll flag");
		if (pass[1] !== "true" && pass[1] !== "false")
			throw new TypeError(thisname + ": error, pass toll flag \"" + speci[1] + "\" not 'true' or 'false'");
		var regi = regionOfRoom(items[1]).toUpperCase();
		var r = (regionCodeToDisplayName[regi] || "") + " / " + (regionCodeToDisplayNameSaint[regi] || "");
		r = r.replace(/^\s\/\s|\s\/\s$/g, "");
		if (r === "")
			throw new TypeError(thisname + ": error, region \"" + regi + "\" not found in regionCodeToDisplayName[]");
		if (items[1] === "gw_c11")
			r += " underground";
		if (items[1] === "gw_c05")
			r += " surface";
		var p = [
			{ type: "icon", value: "Symbol_StunBomb", scale: 1, color: itemNameToIconColorMap["ScavengerBomb"], rotation: 0 },
			{ type: "icon", value: "scavtoll", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
			{ type: "break" },
			{ type: "text", value: items[1].toUpperCase(), color: RainWorldColors.Unity_white }
		];
		if (pass[1] === "true")
			p.splice(2, 0, { type: "icon", value: "singlearrow", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		applyBool(b, 1, 4, pass[1]);
		b[3] = enumToValue(items[1], "tolls");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Throwing grenades at Scavenger tolls",
			items: [items[2], pass[2]],
			values: [items[1], pass[1]],
			description: "Throw a grenade at the " + r + " Scavenger toll" + ((pass[1] === "true") ? ", then pass it." : "."),
			comments: "Bomb and pass must be done in that order, in the same cycle." + getMapLink(items[1].toUpperCase()),
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoCollectPearlChallenge: function(desc) {
		const thisname = "BingoCollectPearlChallenge";
		//	desc of format ["System.Boolean|true|Specific Pearl|0|NULL", "System.String|LF_bottom|Pearl|1|pearls", "0", "System.Int32|1|Amount|3|NULL", "0", "0", ""]
		checkDescriptors(thisname, desc.length, 7, "parameter item count");
		var speci = checkSettingbox(thisname, desc[0], ["System.Boolean", , "Specific Pearl", , "NULL"], "specific pearl flag");
		if (speci[1] !== "true" && speci[1] !== "false")
			throw new TypeError(thisname + ": error, starving flag \"" + speci[1] + "\" not 'true' or 'false'");
		var items = checkSettingbox(thisname, desc[1], ["System.String", , "Pearl", , "pearls"], "pearl selection");
		if (!DataPearlList.includes(items[1])) {
			throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in DataPearlList[]");
		}
		if (dataPearlToDisplayTextMap[items[1]] === undefined)
			throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in dataPearlToDisplayTextMap[]");
		var amounts = checkSettingbox(thisname, desc[3], ["System.Int32", , "Amount", , "NULL"], "amount selection");
		var amt = parseInt(amounts[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + amounts[1] + "\" not a number or out of range");
		var p;
		if (speci[1] === "true") {
			var r;
			if (items[1] === "MS")
				r = "Old " + regionCodeToDisplayName["GW"];
			else {
				var regi = dataPearlToRegionMap[items[1]];
				if (regi === undefined)
					throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in dataPearlToRegionMap[]");
				r = regionCodeToDisplayName[regi];
				//	CL pearl is a possible option from DataPearlList, but Saint doesn't get colored pearl challenges so this doesn't matter
				if (regi === "CL") r = regionCodeToDisplayNameSaint[regi];
				if (r === undefined)
					throw new TypeError(thisname + ": error, region \"" + regi + "\" not found in regionCodeToDisplayName[]");
				if (items[1] === "DM")
					r = regionCodeToDisplayName["DM"] + " / " + r;
			}
			d = "Collect the " + dataPearlToDisplayTextMap[items[1]] + " pearl from " + r + ".";
			p = [
				{ type: "text", value: items[1], color: RainWorldColors.Unity_white },
				{ type: "break" },
				{ type: "icon", value: "Symbol_Pearl", scale: 1, color: dataPearlToColorMap[items[1]], rotation: 0, background: { type: "icon", value: "radialgradient", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } },
				{ type: "break" },
				{ type: "text", value: "[0/1]", color: RainWorldColors.Unity_white }
			];
		} else {
			d = "Collect " + entityNameQuantify(amt, "colored pearls") + ".";
			p = [
				{ type: "icon", value: "pearlhoard_color", scale: 1, color: itemNameToIconColorMap["Pearl"], rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white }
			];
		}
		var b = Array(6); b.fill(0);
		b[0] = challengeValue(thisname);
		applyBool(b, 1, 4, speci[1]);
		b[3] = enumToValue(items[1], "pearls");
		applyShort(b, 4, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Collecting pearls",
			items: [speci[2], items[2], amounts[2]],
			values: [speci[1], items[1], amounts[1]],
			description: d,
			comments: "When collecting multiple pearls, this challenge acts like a flexible The Scholar passage. When collecting single pearls, the amount is unused; when collecting multiple, the location is unused.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoCraftChallenge: function(desc) {
		const thisname = "BingoCraftChallenge";
		//	desc of format ["System.String|JellyFish|Item to Craft|0|craft", "System.Int32|5|Amount|1|NULL", "0", "0", "0"]
		checkDescriptors(thisname, desc.length, 5, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Item to Craft", , "craft"], "item selection");
		if (!BingoEnum_CraftableItems.includes(items[1])) {
			throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in BingoEnum_CraftableItems[]");
		}
		var d = creatureNameToDisplayTextMap[items[1]] || itemNameToDisplayTextMap[items[1]];
		if (d === undefined)
			throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in creature- or itemNameToDisplayTextMap[]");
		var amounts = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "amount selection");
		var amt = parseInt(amounts[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + amounts[1] + "\" not a number or out of range");
		var iconName = creatureNameToIconAtlasMap[items[1]] || itemNameToIconAtlasMap[items[1]];
		var iconColor = creatureNameToIconColorMap[items[1]] || itemNameToIconColorMap[items[1]] || creatureNameToIconColorMap["Default"];
		var b = Array(6); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "craft");
		applyShort(b, 4, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Crafting items",
			items: [items[2], amounts[2]],
			values: [items[1], amounts[1]],
			description: "Craft " + entityNameQuantify(amt, items[1]) + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "crafticon", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: iconName, scale: 1, color: iconColor, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoCreatureGateChallenge: function(desc) {
		const thisname = "BingoCreatureGateChallenge";
		//	desc of format ["System.String|CicadaA|Creature Type|1|transport", "0", "System.Int32|4|Amount|0|NULL", "empty", "0", "0"]
		checkDescriptors(thisname, desc.length, 6, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Creature Type", , "transport"], "creature selection");
		if (!BingoEnum_Transportable.includes(items[1])) {
			throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in BingoEnum_Transportable[]");
		}
		var amounts = checkSettingbox(thisname, desc[2], ["System.Int32", , "Amount", , "NULL"], "amount selection");
		var amt = parseInt(amounts[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + amounts[1] + "\" not a number or out of range");
		if (creatureNameToDisplayTextMap[items[1]] === undefined)
			throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in creature- or itemNameToDisplayTextMap[]");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "transport");
		b[4] = amt;
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Transporting the same creature through gates",
			items: [items[2], amounts[2], "Dictionary"],
			values: [items[1], amounts[1], desc[3]],
			description: "Transport " + entityNameQuantify(1, items[1]) + " through " + String(amt) + " gate" + ((amt > 1) ? "s." : "."),
			comments: "When a creature is taken through a gate, that gate room is added to a list. If a gate already appears in the list, taking that gate again will not advance the count. Thus, you can't grind progress by taking one gate back and forth. The list is stored per creature transported; thus, taking a new different creature does not advance the count, nor does piling creatures into one gate. When the gate count of any logged creature reaches the goal, credit is awarded.",
			paint: [
				{ type: "icon", value: creatureNameToIconAtlasMap[items[1]], scale: 1, color: entityToColor(items[1]), rotation: 0 },
				{ type: "icon", value: "singlearrow", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "ShortcutGate", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoCycleScoreChallenge: function(desc) {
		const thisname = "BingoCycleScoreChallenge";
		//	desc of format ["System.Int32|126|Target Score|0|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.Int32", , "Target Score", , "NULL"], "score goal");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Scoring cycle points",
			items: [items[2]],
			values: [String(amt)],
			description: "Earn " + String(amt) + " points from creature kills in a single cycle.",
			comments: "",
			paint: [
				{ type: "icon", value: "Multiplayer_Star", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "cycle_limit", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoDamageChallenge: function(desc) {
		const thisname = "BingoDamageChallenge";
		var params = textGoalToAbstract(thisname + "~" + desc.join("><"));
		return {
			name: params.GoalName,
			category: params.GoalCategory,
			error: params.error,
			items: params.paramList,
			values: params.valueList,
			description: params.GoalDesc(params),
			comments: params.GoalComments(params),
			paint: params.GoalPaint(params),
			toBin: params.BinEncode(params)
		};
/*
		//	desc of format (< v1.091) ["System.String|JellyFish|Weapon|0|weapons", "System.String|WhiteLizard|Creature Type|1|creatures", "0", "System.Int32|6|Amount|2|NULL", "0", "0"]
		//	or (>= 1.091) ["System.String|JellyFish|Weapon|0|weapons", "System.String|AquaCenti|Creature Type|1|creatures", "0", "System.Int32|5|Amount|2|NULL", "System.Boolean|false|In One Cycle|0|NULL", "System.String|Any Region|Region|5|regions", "System.String|Any Subregion|Subregion|4|subregions", "0", "0"]
		if (desc.length == 6) {
			//	1.091 hack: allow 6 or 9 parameters; assume the existing parameters are ordered as expected
			desc.splice(4, 0, "System.Boolean|false|In One Cycle|0|NULL", "System.String|Any Region|Region|5|regions", "System.String|Any Subregion|Subregion|4|subregions");
		}
		checkDescriptors(thisname, desc.length, 9, "parameter item count");
		var v = [], i = [];
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Weapon", , "weapons"], "weapon choice"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[1], ["System.String", , "Creature Type", , "creatures"], "creature choice"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[3], ["System.Int32", , "Amount", , "NULL"], "hit amount"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[4], ["System.Boolean", , "In One Cycle", , "NULL"], "one-cycle flag"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[5], ["System.String", , "Region", , "regions"], "region selection"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[6], ["System.String", , "Subregion", , "subregions"], "subregion selection"); v.push(items[1]); i.push(items[2]);
		var amt = parseInt(v[2]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + v[2] + "\" not a number or out of range");
		if (!BingoEnum_Weapons.includes(v[0]))
			throw new TypeError(thisname + ": error, item selection \"" + v[0] + "\" not found in BingoEnum_Weapons[]");
		if (v[3] !== "true" && v[3] !== "false")
			throw new TypeError(thisname + ": error, one-cycle flag \"" + v[3] + "\" not 'true' or 'false'");
		var r = "";
		if (v[4] !== "Any Region") {
			r = (regionCodeToDisplayName[v[4]] || "") + " / " + (regionCodeToDisplayNameSaint[v[4]] || "");
			r = r.replace(/^\s\/\s|\s\/\s$/g, "");
			if (r === "")
				throw new TypeError(thisname + ": error, region selection \"" + v[4] + "\" not found in regionCodeToDisplayName[]");
			r = ", in " + r;
		}
		if (v[5] !== "Any Subregion") {
			if (v[5] === "Journey\\'s End") v[5] = "Journey\'s End";
			r = ", in " + v[5];
			if (BingoEnum_AllSubregions.indexOf(v[5]) == -1)
				throw new TypeError(thisname + ": error, subregion selection \"" + v[5] + "\" not found in BingoEnum_AllSubregions[]");
		}
		var p = [];
		if (v[0] !== "Any Weapon") {
			if (itemNameToDisplayTextMap[v[0]] === undefined)
				throw new TypeError(thisname + ": error, item type \"" + v[0] + "\" not found in itemNameToDisplayTextMap[]");
			p.push( { type: "icon", value: itemNameToIconAtlasMap[v[0]], scale: 1, color: entityToColor(v[0]), rotation: 0 } );
		}
		p.push( { type: "icon", value: "bingoimpact", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
		if (v[1] !== "Any Creature") {
			if (creatureNameToDisplayTextMap[v[1]] === undefined)
				throw new TypeError(thisname + ": error, creature type \"" + v[1] + "\" not found in creatureNameToDisplayTextMap[]");
			p.push( { type: "icon", value: creatureNameToIconAtlasMap[v[1]], scale: 1, color: entityToColor(v[1]), rotation: 0 } );
		}
		if (v[5] === "Any Subregion") {
			if (v[4] !== "Any Region") {
				p.push( { type: "break" } );
				p.push( { type: "text", value: v[4], color: RainWorldColors.Unity_white } );
			}
		} else {
			p.push( { type: "break" } );
			p.push( { type: "text", value: v[5], color: RainWorldColors.Unity_white } );
		}
		p.push( { type: "break" } );
		p.push( { type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white } );
		if (v[3] === "true")
			p.push( { type: "icon", value: "cycle_limit", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
		var d = "Hit ";
		d += (creatureNameToDisplayTextMap[v[1]] || v[1]) + " with ";
		d += itemNameToDisplayTextMap[v[0]] || v[0];
		d += " " + String(amt) + ((amt > 1) ? " times" : " time");
		if (r > "") d += r;
		if (v[3] === "true") d += ", in one cycle";
		d += ".";
		//	start with classic format...
		var b = Array(7); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(v[0], "weapons");
		b[4] = enumToValue(v[1], "creatures");
		applyShort(b, 5, amt);
		if (v[3] !== "false" || v[4] !== "Any Region" || v[5] !== "Any Subregion") {
			//	...have to use expanded form
			b[0] = challengeValue("BingoDamageExChallenge");
			applyBool(b, 1, 4, v[3]);
			b.push(enumToValue(v[4], "regions"));
			b.push(enumToValue(v[5], "subregions"));
		}
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Hitting creatures with items",
			items: i,
			values: v,
			description: d,
			comments: "",
			paint: p,
			toBin: new Uint8Array(b)
		};
*/
	},
	BingoDepthsChallenge: function(desc) {
		const thisname = "BingoDepthsChallenge";
		//	desc of format ["System.String|VultureGrub|Creature Type|0|depths", "0", "0"]
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Creature Type", , "depths"], "creature selection");
		if (!BingoEnum_Depthable.includes(items[1])) {
			throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in BingoEnum_Depthable[]");
		}
		var iconName = creatureNameToIconAtlasMap[items[1]];
		var iconColor = creatureNameToIconColorMap[items[1]] || creatureNameToIconColorMap["Default"];
		var d = creatureNameToDisplayTextMap[items[1]];
		if (d === undefined || iconName === undefined || iconColor === undefined)
			throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in creatureNameToDisplayTextMap[]");
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "depths");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Dropping a creature in the depth pit",
			items: [items[2]],
			values: [items[1]],
			description: "Drop " + entityNameQuantify(1, items[1]) + " into the Depths drop room (SB_D06).",
			comments: "Player, and creature of target type, must be in the room at the same time, and the creature's position must be below the drop." + getMapLink("SB_D06"),
			paint: [
				{ type: "icon", value: iconName, scale: 1, color: iconColor, rotation: 0 },
				{ type: "icon", value: "deathpiticon", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "SB_D06", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoDodgeLeviathanChallenge: function(desc) {
		const thisname = "BingoDodgeLeviathanChallenge";
		//	desc of format ["0", "0"]
		checkDescriptors(thisname, desc.length, 2, "parameter item count");
		var b = Array(3); b.fill(0);
		b[0] = challengeValue(thisname);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Dodging a Leviathan",
			items: [],
			values: [],
			description: "Dodge a Leviathan's bite",
			comments: "Being in close proximity to a Leviathan, as it's winding up a bite, will activate this goal. (A more direct/literal interpretation&mdash;having to have been physically inside its maw, then surviving after it slams shut&mdash;was found... too challenging by playtesters.)",
			paint: [
				{ type: "icon", value: "leviathan_dodge", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoDontUseItemChallenge: function(desc) {
		const thisname = "BingoDontUseItemChallenge";
		//	desc of format ["System.String|BubbleGrass|Item type|0|banitem", "0", "0", "0", "0"]
		checkDescriptors(thisname, desc.length, 5, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Item type", , "banitem"], "item selection");
		if (!ALL_ENUMS["banitem"].includes(items[1])) {
			throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in BingoEnum_banitem[]");
		}
		var iconName = creatureNameToIconAtlasMap[items[1]] || itemNameToIconAtlasMap[items[1]];
		var iconColor = creatureNameToIconColorMap[items[1]] || itemNameToIconColorMap[items[1]] || creatureNameToIconColorMap["Default"];
		var d = creatureNameToDisplayTextMap[items[1]] || itemNameToDisplayTextMap[items[1]];
		if (d === undefined)
			throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in creature- or itemNameToDisplayTextMap[]");
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		applyBool(b, 1, 4, String(desc[1] === "1"));
		applyBool(b, 1, 5, String(desc[4] === "1"));
		b[3] = enumToValue(items[1], "banitem");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Avoiding items",
			items: [items[2], "isFood", "isCreature"],
			values: [items[2], desc[1] === "1", desc[4] === "1"],
			description: "Never " + ((desc[1] === "1") ? "eat" : "use") + " " + d + ".",
			comments: "\"Using\" an item involves throwing a throwable item, eating a food item, or holding any other type of item for 5 seconds. (When sheltering with insufficient food pips (currently eaten), food items in the shelter are consumed automatically. Auto-eating on shelter <em>will not</em> count against this goal!)",
			paint: [
				{ type: "icon", value: "buttonCrossA", scale: 1, color: RainWorldColors.Unity_red, rotation: 0 },
				{ type: "icon", value: iconName, scale: 1, color: iconColor, rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoEatChallenge: function(desc) {
		const thisname = "BingoEatChallenge";
		//	desc of format ["System.Int32|6|Amount|1|NULL", "0", "0", "System.String|DangleFruit|Food type|0|food", "0", "0"]
		checkDescriptors(thisname, desc.length, 6, "parameter item count");
		var amounts = checkSettingbox(thisname, desc[0], ["System.Int32", , "Amount", , "NULL"], "eat amount");
		var amt = parseInt(amounts[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + amounts[1] + "\" not a number or out of range");
		var items = checkSettingbox(thisname, desc[3], ["System.String", , "Food type", , "food"], "eat type");
		if (!BingoEnum_FoodTypes.includes(items[1]))
			throw new TypeError(thisname + ": error, item selection \"" + items[1] + "\" not found in BingoEnum_FoodTypes[]");
		var iconName = creatureNameToIconAtlasMap[items[1]] || itemNameToIconAtlasMap[items[1]];
		var iconColor = creatureNameToIconColorMap[items[1]] || itemNameToIconColorMap[items[1]] || creatureNameToIconColorMap["Default"];
		var d = creatureNameToDisplayTextMap[items[1]] || itemNameToDisplayTextMap[items[1]];
		var b = Array(6); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		applyBool(b, 1, 4, String(desc[2] === "1"));
		b[5] = enumToValue(items[1], "food");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Eating specific food",
			items: [amounts[2], items[2]],
			values: [amounts[1], items[1]],
			description: "Eat " + entityNameQuantify(amt, items[1]) + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "foodSymbol", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: iconName, scale: 1, color: iconColor, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoEchoChallenge: function(desc) {
		const thisname = "BingoEchoChallenge";
		//	desc of format ["System.String|SB|Region|0|echoes", "System.Boolean|false|While Starving|1|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var echor = checkSettingbox(thisname, desc[0], ["System.String", , "Region", , "echoes"], "echo region");
		var r = (regionCodeToDisplayName[echor[1]] || "") + " / " + (regionCodeToDisplayNameSaint[echor[1]] || "");
		r = r.replace(/^\s\/\s|\s\/\s$/g, "");
		if (r === "")
			throw new TypeError(thisname + ": error, region \"" + echor[1] + "\" not found in regionCodeToDisplayName[]");
		var items = checkSettingbox(thisname, desc[1], ["System.Boolean", , "While Starving", , "NULL"], "starving flag");
		if (items[1] !== "true" && items[1] !== "false")
			throw new TypeError(thisname + ": error, starving flag \"" + items[1] + "\" not 'true' or 'false'");
		var p = [
			{ type: "icon", value: "echo_icon", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
			{ type: "text", value: echor[1], color: RainWorldColors.Unity_white }
		];
		if (items[1] === "true") {
			p.push( { type: "break" } );
			p.push( { type: "icon", value: "Multiplayer_Death", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
		}
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		applyBool(b, 1, 4, items[1]);
		b[3] = enumToValue(echor[1], "echoes");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Visiting echoes",
			items: [echor[2], items[2]],
			values: [echor[1], items[1]],
			description: "Visit the " + r + " Echo" + ((items[1] === "true") ? ", while starving." : "."),
			comments: "",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoEnterRegionChallenge: function(desc) {
		const thisname = "BingoEnterRegionChallenge";
		//	desc of format ["System.String|CC|Region|0|regionsreal", "0", "0"]
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Region", , "regionsreal"], "enter region");
		var r = (regionCodeToDisplayName[items[1]] || "") + " / " + (regionCodeToDisplayNameSaint[items[1]] || "");
		r = r.replace(/^\s\/\s|\s\/\s$/g, "");
		if (r === "")
			throw new TypeError(thisname + ": error, region \"" + items[1] + "\" not found in regionCodeToDisplayName[]");
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "regionsreal");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Entering a region",
			items: [items[2]],
			values: [items[1]],
			description: "Enter " + r + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "keyShiftA", scale: 1, color: RainWorldColors.Unity_green, rotation: 90 },
				{ type: "text", value: items[1], color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoGlobalScoreChallenge: function(desc) {
		const thisname = "BingoGlobalScoreChallenge";
		//	desc of format ["0", "System.Int32|271|Target Score|0|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Target Score", , "NULL"], "score goal");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Scoring global points",
			items: [items[2]],
			values: [String(amt)],
			description: "Earn " + amt + " points from creature kills.",
			comments: "",
			paint: [
				{ type: "icon", value: "Multiplayer_Star", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + amt + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoGreenNeuronChallenge: function(desc) {
		const thisname = "BingoGreenNeuronChallenge";
		//	desc of format ["System.Boolean|true|Looks to the Moon|0|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.Boolean", , "Looks to the Moon", , "NULL"], "iterator choice flag");
		if (items[1] !== "true" && items[1] !== "false")
			throw new TypeError(thisname + ": error, iterator choice flag \"" + items[1] + "\" not 'true' or 'false'");
		var d;
		var p = [
			{ type: "icon", value: "GuidanceNeuron", scale: 1, color: RainWorldColors["GuidanceNeuron"], rotation: 0 },
			{ type: "icon", value: "singlearrow", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
		]
		if (items[1] === "true") {
			d = "Reactivate Looks to the Moon.";
			p.push( { type: "icon", value: "GuidanceMoon", scale: 1, color: RainWorldColors["GuidanceMoon"], rotation: 0 } );
		} else {
			d = "Deliver the green neuron to Five Pebbles.";
			p.push( { type: "icon", value: "nomscpebble", scale: 1, color: RainWorldColors["nomscpebble"], rotation: 0 } );
		}
		var b = Array(3); b.fill(0);
		b[0] = challengeValue(thisname);
		applyBool(b, 1, 4, items[1]);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Delivering the green neuron",
			items: [items[2]],
			values: [items[1]],
			description: d,
			comments: "The green neuron only has to enter the screen the iterator is on and start the cutscene; waiting for full dialog/startup is not required for credit.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoHatchNoodleChallenge: function(desc) {
		const thisname = "BingoHatchNoodleChallenge";
		//	desc of format ["0", "System.Int32|3|Amount|1|NULL", "System.Boolean|true|At Once|0|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 5, "parameter item count");
		var amounts = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "egg count");
		var amt = parseInt(amounts[1]);
		amt = Math.min(amt, CHAR_MAX);
		if (isNaN(amt) || amt < 0)
			throw new TypeError(thisname + ": error, amount \"" + amounts[1] + "\" not a number or out of range");
		items = checkSettingbox(thisname, desc[2], ["System.Boolean", , "At Once", , "NULL"], "one-cycle flag");
		if (items[1] !== "true" && items[1] !== "false")
			throw new TypeError(thisname + ": error, one-cycle flag \"" + items[1] + "\" not 'true' or 'false'");
		var p = [
			{ type: "icon", value: itemNameToIconAtlasMap["NeedleEgg"], scale: 1, color: itemNameToIconColorMap["NeedleEgg"], rotation: 0 },
			{ type: "icon", value: creatureNameToIconAtlasMap["SmallNeedleWorm"], scale: 1, color: entityToColor("SmallNeedleWorm"), rotation: 0 },
			{ type: "break" },
			{ type: "text", value: "[0/" + amt + "]", color: RainWorldColors.Unity_white },
		];
		if (items[1] === "true")
			p.splice(2, 0, { type: "icon", value: "cycle_limit", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = amt;
		applyBool(b, 1, 4, items[1]);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Hatching noodlefly eggs",
			items: [amounts[2], items[2]],
			values: [amounts[1], items[1]],
			description: "Hatch " + entityNameQuantify(amt, "NeedleEgg") + ((items[1] === "true") ? " in one cycle." : "."),
			comments: "Eggs must be hatched where the player is sheltering. Eggs stored in other shelters disappear and do not give credit towards this goal.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoHellChallenge: function(desc) {
		const thisname = "BingoHellChallenge";
		//	desc of format ["0", "System.Int32|2|Amount|0|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "goal count");
		var amt = parseInt(items[1]);
		amt = Math.min(amt, CHAR_MAX);
		if (isNaN(amt) || amt < 0)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = amt;
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Not dying before completing challenges",
			items: [items[2]],
			values: [String(amt)],
			description: "Do not die before completing " + entityNameQuantify(amt, "bingo challenges") + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "completechallenge", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "text", value: "[0/" + amt + "]", color: RainWorldColors.Unity_white },
				{ type: "break" },
				{ type: "icon", value: "buttonCrossA", scale: 1, color: RainWorldColors.Unity_red, rotation: 0 },
				{ type: "icon", value: "Multiplayer_Death", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoItemHoardChallenge: function(desc) {
		const thisname = "BingoItemHoardChallenge";
		//	desc of format (< v1.092) ["System.Int32|5|Amount|1|NULL", "System.String|PuffBall|Item|0|expobject", "0", "0"]
		//	or (>= 1.092) ["System.Boolean|true|Any Shelter|2|NULL", "0", "System.Int32|4|Amount|0|NULL", "System.String|DangleFruit|Item|1|expobject", "0", "0", ""]
		if (desc.length == 4) {
			//	1.092 hack: allow 4 or 7 parameters; assume the existing parameters are ordered as expected
			desc.unshift("System.Boolean|false|Any Shelter|2|NULL", "0");
			desc.push("");
		}
		checkDescriptors(thisname, desc.length, 7, "parameter item count");
		var any = checkSettingbox(thisname, desc[0], ["System.Boolean", , "Any Shelter", , "NULL"], "any shelter flag");
		var amounts = checkSettingbox(thisname, desc[2], ["System.Int32", , "Amount", , "NULL"], "item count");
		var items = checkSettingbox(thisname, desc[3], ["System.String", , "Item", , "expobject"], "item selection");
		if (!BingoEnum_Storable.includes(items[1]))
			throw new TypeError(thisname + ": error, item selection \"" + items[1] + "\" not found in BingoEnum_Storable[]");
		var amt = parseInt(amounts[1]);
		amt = Math.min(amt, CHAR_MAX);
		if (isNaN(amt) || amt < 0)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		if (any[1] !== "true" && any[1] !== "false")
			throw new TypeError(thisname + ": error, any shelter flag \"" + any[1] + "\" not 'true' or 'false'");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyBool(b, 1, 4, any[1]);
		b[3] = amt;
		b[4] = enumToValue(items[1], "expobject");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Hoarding items in shelters",
			items: [amounts[2], items[2]],
			values: [String(amt), items[1]],
			description: "Store " + entityNameQuantify(amt, items[1]) + " in " + ((any[1] === "true") ? "any shelter(s)." : ((amt == 1) ? "a shelter." : "the same shelter.")),
			comments: "The 'Any Shelter' option counts the total across any shelters in the world. Counts are per item ID, and are updated on shelter close. Counts never go down, so the items are free to use after bringing them into a shelter, including eating or removing them. Because items are tracked by ID, this goal cannot be cheesed by taking the same items between multiple shelters; multiple unique items must be hoarded. In short, it's the act of hoarding (putting new items in a shelter and closing the shelter) that counts up.",
			paint: [
				{ type: "icon", value: ((any[1] === "true") ? "doubleshelter" : "ShelterMarker"), scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: itemNameToIconAtlasMap[items[1]], scale: 1, color: entityToColor(items[1]), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + amt + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoKarmaFlowerChallenge: function(desc) {
		const thisname = "BingoKarmaFlowerChallenge";
		//	assert: desc of format ["0", "System.Int32|5|Amount|0|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "item count");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Consuming Karma Flowers",
			items: [items[2]],
			values: [String(amt)],
			description: "Consume " + entityNameQuantify(amt, "KarmaFlower") + ".",
			comments: "With this goal present on the board, flowers are spawned in the world in their normal locations. The player obtains the benefit of consuming the flower (protecting karma level). While the goal is in progress, players <em>do not drop</em> the flower on death. After the goal is completed or locked, a flower can drop on death as normal.",
			paint: [
				{ type: "icon", value: "foodSymbol", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "FlowerMarker", scale: 1, color: RainWorldColors.SaturatedGold, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + items[1] + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoKillChallenge: function(desc) {
		const thisname = "BingoKillChallenge";
		//	assert: desc of format ["System.String|Scavenger|Creature Type|0|creatures",
		//	"System.String|Any Weapon|Weapon Used|6|weaponsnojelly", "System.Int32|5|Amount|1|NULL", "0",
		//	"System.String|Any Region|Region|5|regions", "System.String|Any Subregion|Subregion|4|subregions",
		//	"System.Boolean|false|In one Cycle|3|NULL", "System.Boolean|false|Via a Death Pit|7|NULL",
		//	"System.Boolean|false|While Starving|2|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 11, "parameter item count");
		var v = [], i = [];
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Creature Type", , "creatures"], "target selection"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[1], ["System.String", , "Weapon Used", , "weaponsnojelly"], "weapon selection"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[2], ["System.Int32", , "Amount", , "NULL"], "kill count"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[4], ["System.String", , "Region", , "regions"], "region selection"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[5], ["System.String", , "Subregion", , "subregions"], "subregion selection"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[6], ["System.Boolean", , "In one Cycle", , "NULL"], "one-cycle flag"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[7], ["System.Boolean", , "Via a Death Pit", , "NULL"], "death pit flag"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[8], ["System.Boolean", , "While Starving", , "NULL"], "starving flag"); v.push(items[1]); i.push(items[2]);
		var r = "";
		var amt = parseInt(v[2]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + v[2] + "\" not a number or out of range");
		if (v[0] !== "Any Creature") {
			if (creatureNameToDisplayTextMap[v[0]] === undefined)
				throw new TypeError(thisname + ": error, creature type \"" + v[0] + "\" not found in creatureNameToDisplayTextMap[]");
		}
		var c = entityNameQuantify(amt, (v[0] !== "Any Creature") ? v[0] : "creatures");
		if (v[3] !== "Any Region") {
			r = (regionCodeToDisplayName[v[3]] || "") + " / " + (regionCodeToDisplayNameSaint[v[3]] || "");
			r = r.replace(/^\s\/\s|\s\/\s$/g, "");
			if (r === "")
				throw new TypeError(thisname + ": error, region selection \"" + v[3] + "\" not found in regionCodeToDisplayName[]");
			r = " in " + r;
		}
		if (v[4] !== "Any Subregion") {
			if (v[4] === "Journey\\'s End") v[4] = "Journey\'s End";
			r = " in " + v[4];
			if (BingoEnum_AllSubregions.indexOf(v[4]) == -1)
				throw new TypeError(thisname + ": error, subregion selection \"" + v[4] + "\" not found in BingoEnum_AllSubregions[]");
		}
		var w = ", with a death pit";
		if (!BingoEnum_Weapons.includes(v[1]))
			throw new TypeError(thisname + ": error, weapon selection \"" + v[1] + "\" not found in BingoEnum_Weapons[]");
		if (v[6] === "false") {
			if (v[1] !== "Any Weapon") {
				w = " with " + itemNameToDisplayTextMap[v[1]];
			} else {
				w = "";
			}
		}
		var p = [];
		if (v[1] !== "Any Weapon" || v[6] === "true") {
			if (v[6] === "true")
				p.push( { type: "icon", value: "deathpiticon", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
			else
				p.push( { type: "icon", value: itemNameToIconAtlasMap[v[1]], scale: 1, color: entityToColor(v[1]), rotation: 0 } );
		}
		if (v[5] !== "true" && v[5] !== "false")
			throw new TypeError(thisname + ": error, one-cycle flag \"" + v[5] + "\" not 'true' or 'false'");
		if (v[6] !== "true" && v[6] !== "false")
			throw new TypeError(thisname + ": error, death pit flag \"" + v[6] + "\" not 'true' or 'false'");
		if (v[7] !== "true" && v[7] !== "false")
			throw new TypeError(thisname + ": error, starving flag \"" + v[7] + "\" not 'true' or 'false'");
		p.push( { type: "icon", value: "Multiplayer_Bones", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
		if (v[0] !== "Any Creature") {
			p.push( { type: "icon", value: creatureNameToIconAtlasMap[v[0]], scale: 1,
					color: entityToColor(v[0]), rotation: 0 } );
		}
		p.push( { type: "break" } );
		if (v[4] === "Any Subregion") {
			if (v[3] !== "Any Region") {
				p.push( { type: "text", value: v[3], color: RainWorldColors.Unity_white } );
				p.push( { type: "break" } );
			}
		} else {
			p.push( { type: "text", value: v[4], color: RainWorldColors.Unity_white } );
			p.push( { type: "break" } );
		}
		p.push( { type: "text", value: "[0/" + v[2] + "]", color: RainWorldColors.Unity_white } );
		if (v[7] === "true")
			p.push( { type: "icon", value: "Multiplayer_Death", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
		if (v[5] === "true")
			p.push( { type: "icon", value: "cycle_limit", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
		var b = Array(9); b.fill(0);
		b[0] = challengeValue(thisname);
		applyBool(b, 1, 4, v[5]);
		applyBool(b, 1, 5, v[6]);
		applyBool(b, 1, 6, v[7]);
		b[3] = enumToValue(v[0], "creatures");
		b[4] = enumToValue(v[1], "weaponsnojelly");
		applyShort(b, 5, amt);
		b[7] = enumToValue(v[3], "regions");
		b[8] = enumToValue(v[4], "subregions");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Killing creatures",
			items: i,
			values: v,
			description: "Kill " + c + r + w
					+ ((v[7] === "true") ? ", while starving" : "")
					+ ((v[5] === "true") ? ", in one cycle"   : "") + ".",
			comments: "(If defined, subregion takes precedence over region. If set, Death Pit takes precedence over weapon selection.)<br>" +
					"Credit is determined by the last source of 'blame' at time of death. For creatures that take multiple hits, try to \"soften them up\" with more common items, before using limited ammunition to deliver the killing blow.  Creatures that \"bleed out\", can be mortally wounded (brought to or below 0 HP), before being tagged with a specific weapon to obtain credit. Conversely, weapons that do slow damage (like Spore Puff) can lose blame over time; consider carrying additional ammunition to deliver the killing blow. Starving: must be in the \"malnourished\" state; this state is cleared after eating to full.<br>" +
					"Note: the reskinned BLLs in the Past Garbage Wastes tunnel, count as both BLL and DLL for this challenge.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoMaulTypesChallenge: function(desc) {
		const thisname = "BingoMaulTypesChallenge";
		//	desc of format "0", "System.Int32|4|Amount|0|NULL", "0", "0", ""
		checkDescriptors(thisname, desc.length, 5, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "maul amount");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 0 || amt > ALL_ENUMS["creatures"].length)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = amt;
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Mauling different types of creatures",
			items: ["Amount"],
			values: [String(amt)],
			description: "Maul " + String(amt) + " different types of creatures.",
			comments: "",
			paint: [
				{ type: "icon", value: "artimaulcrit", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoMaulXChallenge: function(desc) {
		const thisname = "BingoMaulXChallenge";
		//	desc of format ["0", "System.Int32|13|Amount|0|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "maul amount");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Mauling creatures a certain amount of times",
			items: ["Amount"],
			values: [String(amt)],
			description: "Maul creatures " + String(amt) + " times.",
			comments: "",
			paint: [
				{ type: "icon", value: "artimaul", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoNeuronDeliveryChallenge: function(desc) {
		const thisname = "BingoNeuronDeliveryChallenge";
		//	desc of format ["System.Int32|2|Amount of Neurons|0|NULL", "0", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.Int32", , "Amount of Neurons", , "NULL"], "neuron amount");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Gifting neurons",
			items: ["Amount"],
			values: [String(amt)],
			description: "Deliver " + entityNameQuantify(amt, "Neurons") + " to Looks to the Moon.",
			comments: "",
			paint: [
				{ type: "icon", value: "Symbol_Neuron", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "singlearrow", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "GuidanceMoon", scale: 1, color: RainWorldColors["GuidanceMoon"], rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoNoNeedleTradingChallenge: function(desc) {
		const thisname = "BingoNoNeedleTradingChallenge";
		//	desc of format ["0", "0"]
		checkDescriptors(thisname, desc.length, 2, "parameter item count");
		var b = Array(3); b.fill(0);
		b[0] = challengeValue(thisname);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Avoiding gifting Needles to Scavengers",
			items: [],
			values: [],
			description: "Do not gift Needles to Scavengers.",
			comments: "",
			paint: [
				{ type: "icon", value: "spearneedle", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "commerce", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "Kill_Scavenger", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "icon", value: "buttonCrossA", scale: 1, color: RainWorldColors.Unity_red, rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoNoRegionChallenge: function(desc) {
		const thisname = "BingoNoRegionChallenge";
		//	desc of format ["System.String|SI|Region|0|regionsreal", "0", "0"]
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Region", , "regionsreal"], "avoid region");
		var r = (regionCodeToDisplayName[items[1]] || "") + " / " + (regionCodeToDisplayNameSaint[items[1]] || "");
		r = r.replace(/^\s\/\s|\s\/\s$/g, "");
		if (r === "")
			throw new TypeError(thisname + ": error, region \"" + items[1] + "\" not found in regionCodeToDisplayName[]");
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "regionsreal");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Avoiding a region",
			items: [items[2]],
			values: [items[1]],
			description: "Do not enter " + r + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "buttonCrossA", scale: 1, color: RainWorldColors.Unity_red, rotation: 0 },
				{ type: "text", value: items[1], color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoPearlDeliveryChallenge: function(desc) {
		const thisname = "BingoPearlDeliveryChallenge";
		//	desc of format ["System.String|LF|Pearl from Region|0|regions", "0", "0"]
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Pearl from Region", , "regions"], "pearl region");
		var r = (regionCodeToDisplayName[items[1]] || "") + " / " + (regionCodeToDisplayNameSaint[items[1]] || "");
		r = r.replace(/^\s\/\s|\s\/\s$/g, "");
		if (r === "")
			throw new TypeError(thisname + ": error, region \"" + items[1] + "\" not found in regionCodeToDisplayName[]");
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "regions");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Delivering colored pearls to an Iterator",
			items: [items[2]],
			values: [items[1]],
			description: "Deliver " + r + " colored pearl to Looks To The Moon (Artificer: Five Pebbles)",
			comments: "",
			paint: [
				{ type: "text", value: items[1], color: RainWorldColors.Unity_white },
				{ type: "icon", value: "Symbol_Pearl", scale: 1, color: itemNameToIconColorMap["Pearl"], rotation: 0 },
				{ type: "break" },
				{ type: "icon", value: "singlearrow", scale: 1, color: RainWorldColors.Unity_white, rotation: 90 },
				{ type: "break" },
/*				{ type: "icon", value: "nomscpebble", scale: 1, color: RainWorldColors["nomscpebble"], rotation: 0 }, */
				{ type: "icon", value: "GuidanceMoon", scale: 1, color: RainWorldColors["GuidanceMoon"], rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoPearlHoardChallenge: function(desc) {
		const thisname = "BingoPearlHoardChallenge";
		//	desc of format ["System.Boolean|false|Common Pearls|0|NULL", "System.Int32|2|Amount|1|NULL", "System.String|SL|In Region|2|regions", "0", "0"]
		checkDescriptors(thisname, desc.length, 5, "parameter item count");
		var v = [], i = [];
		var items = checkSettingbox(thisname, desc[0], ["System.Boolean", , "Common Pearls", , "NULL"], "common pearls flag"); v.push(items[1]); i.push(items[2]);
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "pearl count"); v.push(items[1]); i.push(items[2]);
		desc[2] = desc[2].replace(/regionsreal/, "regions");	//	both acceptable (v0.85/0.90)
		var items = checkSettingbox(thisname, desc[2], ["System.String", , "In Region", , "regions"], "region selection"); v.push(items[1]); i.push(items[2]);
		if (v[0] !== "true" && v[0] !== "false")
			throw new TypeError(thisname + ": error, common pearls flag \"" + v[0] + "\" not 'true' or 'false'");
		var amt = parseInt(v[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + v[1] + "\" not a number or out of range");
		if (v[2] !== "Any Region") {
			var r = (regionCodeToDisplayName[v[2]] || "") + " / " + (regionCodeToDisplayNameSaint[v[2]] || "");
			r = r.replace(/^\s\/\s|\s\/\s$/g, "");
			if (r === "")
				throw new TypeError(thisname + ": error, region \"" + v[2] + "\" not found in regionCodeToDisplayName[]");
		} else
			r = "any region";
		var pearl = " common pearls";
		if (v[0] === "false") pearl = " colored pearls";
		if (amt == 1) pearl = pearl.substring(0, pearl.length - 1);
		var b = Array(6); b.fill(0);
		b[0] = challengeValue(thisname);
		applyBool(b, 1, 4, v[0]);
		applyShort(b, 3, amt);
		b[5] = enumToValue(v[2], "regions");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Hoarding pearls in shelters",
			items: i,
			values: v,
			description: "Store " + String(amt) + pearl + " in a shelter in " + r + ".",
			comments: "Note: faded pearls (colored pearl spawns in Saint campaign) do not count toward a \"common pearls\" goal.",
			paint: [
				{ type: "icon", value: "ShelterMarker", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: ((v[0] === "true") ? "pearlhoard_normal" : "pearlhoard_color"), scale: 1, color: itemNameToIconColorMap["Pearl"], rotation: 0 },
				{ type: "text", value: v[2], color: RainWorldColors.Unity_white },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoPinChallenge: function(desc) {
		const thisname = "BingoPinChallenge";
		//	desc of format ["0", "System.Int32|5|Amount|0|NULL", "System.String|PinkLizard|Creature Type|1|creatures", "", "System.String|SU|Region|2|regions", "0", "0"]
		checkDescriptors(thisname, desc.length, 7, "parameter item count");
		var v = [], i = [];
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "pin amount"); v.push(items[1]); i.push(items[2]);
		var items = checkSettingbox(thisname, desc[2], ["System.String", , "Creature Type", , "creatures"], "creature type"); v.push(items[1]); i.push(items[2]);
		var items = checkSettingbox(thisname, desc[4], ["System.String", , "Region", , "regions"], "region selection"); v.push(items[1]); i.push(items[2]);
		var amt = parseInt(v[0]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + v[0] + "\" not a number or out of range");
		if (v[1] !== "Any Creature") {
			if (creatureNameToDisplayTextMap[v[1]] === undefined)
				throw new TypeError(thisname + ": error, creature type \"" + v[1] + "\" not found in creatureNameToDisplayTextMap[]");
		}
		var c = entityNameQuantify(amt, (v[1] !== "Any Creature") ? v[1] : "creatures");
		var r = v[2];
		if (r !== "Any Region") {
			r = (regionCodeToDisplayName[v[2]] || "") + " / " + (regionCodeToDisplayNameSaint[v[2]] || "");
			r = r.replace(/^\s\/\s|\s\/\s$/g, "");
			if (r === "")
				throw new TypeError(thisname + ": error, region \"" + v[2] + "\" not found in regionCodeToDisplayName[]");
		} else {
			r = "different regions";
		}
		var p = [ { type: "icon", value: "pin_creature", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } ];
		if (v[1] !== "Any Creature") {
			p.push( { type: "icon", value: creatureNameToIconAtlasMap[v[1]], scale: 1, color: creatureNameToIconColorMap[v[1]] || creatureNameToIconColorMap["Default"], rotation: 0 } );
		}
		if (v[2] === "Any Region") {
			p.push( { type: "icon", value: "TravellerA", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
		} else {
			p.push( { type: "text", value: v[2], color: RainWorldColors.Unity_white } );
		}
		p.push( { type: "break" } );
		p.push( { type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white } );
		var b = Array(7); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[5] = enumToValue(v[1], "creatures");
		b[6] = enumToValue(v[2], "regions");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Pinning creatures to walls",
			items: i,
			values: v,
			description: "Pin " + c + " to walls or floors in " + r + ".",
			comments: "A creature does not need to be alive to obtain pin credit. Sometimes a body chunk gets pinned but does not credit the challenge; keep retrying on different parts of a corpse until it works. \"Different regions\" means one pin per region, as many unique regions as pins required.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoPopcornChallenge: function(desc) {
		const thisname = "BingoPopcornChallenge";
		//	desc of format ["0", "System.Int32|6|Amount|0|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "pop amount");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Popping popcorn plants",
			items: [items[2]],
			values: [String(amt)],
			description: "Open " + entityNameQuantify(amt, "popcorn plants") + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "Symbol_Spear", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "popcorn_plant", scale: 1, color: RainWorldColors["popcorn_plant"], rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoRivCellChallenge: function(desc) {
		const thisname = "BingoRivCellChallenge";
		//	desc of format ["0", "0"]
		checkDescriptors(thisname, desc.length, 2, "parameter item count");
		var b = Array(3); b.fill(0);
		b[0] = challengeValue(thisname);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Feeding the Rarefaction Cell to a Leviathan",
			items: [],
			values: [],
			description: "Feed the Rarefaction Cell to a Leviathan (completes if you die).",
			comments: "Truly, the Rarefaction Cell's explosion transcends time and space; hence, this goal is awarded even if the player dies in the process. Godspeed, little Water Dancer.",
			paint: [
				{ type: "icon", value: "Symbol_EnergyCell", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "Kill_BigEel", scale: 1, color: creatureNameToIconColorMap["BigEel"] || creatureNameToIconColorMap["Default"], rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoSaintDeliveryChallenge: function(desc) {
		const thisname = "BingoSaintDeliveryChallenge";
		//	desc of format ["0", "0"]
		checkDescriptors(thisname, desc.length, 2, "parameter item count");
		var b = Array(3); b.fill(0);
		b[0] = challengeValue(thisname);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Delivering the music pearl to Five Pebbles",
			items: [],
			values: [],
			description: "Deliver the music pearl to Five Pebbles",
			comments: "Credit is awarded when Five Pebbles resumes playing the pearl; wait for dialog to finish, and place the pearl within reach.",
			paint: [
				{ type: "icon", value: "memoriespearl", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "singlearrow", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "nomscpebble", scale: 1, color: RainWorldColors["nomscpebble"], rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoSaintPopcornChallenge: function(desc) {
		const thisname = "BingoSaintPopcornChallenge";
		//	desc of format ["0", "System.Int32|7|Amount|0|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "seed amount");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Eating popcorn plant seeds",
			items: [items[2]],
			values: [String(amt)],
			description: "Eat " + entityNameQuantify(amt, "Seed") + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "foodSymbol", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "Symbol_Seed", scale: 1, color: itemNameToIconColorMap["Default"], rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoStealChallenge: function(desc) {
		const thisname = "BingoStealChallenge";
		//	assert: desc of format ["System.String|Rock|Item|1|theft",
		//	"System.Boolean|false|From Scavenger Toll|0|NULL",
		//	"0", "System.Int32|3|Amount|2|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 6, "parameter item count");
		var v = [], i = [];
		var p = [ { type: "icon", value: "steal_item", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } ];
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Item", , "theft"], "item selection"); v.push(items[1]); i.push(items[2]);
		if (!BingoEnum_theft.includes(v[0]))
			throw new TypeError(thisname + ": error, item \"" + v[0] + "\" not found in BingoEnum_theft[]");
		items = checkSettingbox(thisname, desc[3], ["System.Int32", , "Amount", , "NULL"], "item count"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[1], ["System.Boolean", , "From Scavenger Toll", , "NULL"], "venue flag"); v.push(items[1]); i.push(items[2]);
		if (itemNameToDisplayTextMap[v[0]] === undefined)
			throw new TypeError(thisname + ": error, item selection \"" + v[2] + "\" not found in itemNameToDisplayTextMap[]");
		var amt = parseInt(v[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + v[1] + "\" not a number or out of range");
		var d = "Steal " + String(amt) + " " + itemNameToDisplayTextMap[v[0]] + " from ";
		p.push( { type: "icon", value: itemNameToIconAtlasMap[v[0]], scale: 1,
				color: entityToColor(v[0]), rotation: 0 } );
		if (v[2] === "true") {
			p.push( { type: "icon", value: "scavtoll", scale: 0.8, color: RainWorldColors.Unity_white, rotation: 0 } );
			d += "a Scavenger Toll.";
		} else if (v[2] === "false") {
			p.push( { type: "icon", value: creatureNameToIconAtlasMap["Scavenger"], scale: 1,
					color: entityToColor("Scavenger"), rotation: 0 } );
			d += "Scavengers.";
		} else {
			throw new TypeError(thisname + ": error, venue flag \"" + v[2] + "\" not 'true' or 'false'");
		}
		p.push( { type: "break" } );
		p.push( { type: "text", value: "[0/" + v[1] + "]", color: RainWorldColors.Unity_white } );
		var b = Array(6); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(v[0], "theft");
		applyBool(b, 1, 4, v[2]);
		applyShort(b, 4, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Stealing items",
			items: i,
			values: v,
			description: d,
			comments: "",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoTameChallenge: function(desc) {
		const thisname = "BingoTameChallenge";
		var params = textGoalToAbstract(thisname + "~" + desc.join("><"));
		return {
			name: params.RootGoal,
			category: params.GoalCategory,
			error: params.error,
			items: params.paramList,
			values: params.valueList,
			description: params.GoalDesc(params),
			comments: params.GoalComments(params),
			paint: params.GoalPaint(params),
			toBin: params.BinEncode(params)
		};
	},
	BingoTradeChallenge: function(desc) {
		const thisname = "BingoTradeChallenge";
		//	desc of format ["0", "System.Int32|15|Value|0|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Value", , "NULL"], "points value");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Trading items to Merchants",
			items: [items[2]],
			values: [String(amt)],
			description: "Trade " + String(amt) + " points worth of items to Scavenger Merchants.",
			comments: "A trade occurs when: 1. a Scavenger sees you with item in hand, 2. sees you drop the item, and 3. picks up that item. When the Scavenger is also a Merchant, points will be awarded. Any item can be traded once to award points according to its value; this includes items initially held (then dropped/traded) by Scavenger Merchants. If an item seems to have been ignored or missed, try trading it again.<br>Stealing and murder will <em>not</em> result in points being awarded.",
			paint: [
				{ type: "icon", value: "scav_merchant", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoTradeTradedChallenge: function(desc) {
		const thisname = "BingoTradeTradedChallenge";
		//	desc of format ["0", "System.Int32|3|Amount of Items|0|NULL", "empty", "0", "0"]
		checkDescriptors(thisname, desc.length, 5, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount of Items", , "NULL"], "amount of items");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Trading already traded items",
			items: [items[2]],
			values: [String(amt)],
			description: "Trade " + String(amt) + ((amt == 1) ? " item" : " items") + " from Scavenger Merchants to other Scavenger Merchants.",
			comments: "A trade occurs when: 1. a Scavenger sees you with item in hand, 2. sees you drop the item, and 3. picks up that item. While this challenge is active, any item dropped by a Merchant, due to a trade, will be \"blessed\" and thereafter bear a mark indicating its eligibility for this challenge.<br>In a Merchant room, the Merchant bears a '<span style=\"color: #00ff00; font-weight: bold;\">✓</span>' tag to show who you should trade with; other Scavengers in the room are tagged with '<span style=\"color: #ff0000; font-weight: bold;\">X</span>'.<br>A \"blessed\" item can then be brought to any <em>other</em> Merchant and traded, to award credit.<br>Stealing from or murdering a Merchant will not result in \"blessed\" items dropping (unless they were already traded).",
			paint: [
				{ type: "icon", value: "scav_merchant", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "Menu_Symbol_Shuffle", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "scav_merchant", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoTransportChallenge: function(desc) {
		const thisname = "BingoTransportChallenge";
		//	desc of format ["System.String|Any Region|From Region|0|regions", "System.String|DS|To Region|1|regions", "System.String|CicadaA|Creature Type|2|transport", "", "0", "0"]
		checkDescriptors(thisname, desc.length, 6, "parameter item count");
		var v = [], i = [];
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "From Region", , "regions"], "from region"); v.push(items[1]); i.push(items[2]);
		var items = checkSettingbox(thisname, desc[1], ["System.String", , "To Region", , "regions"], "to region"); v.push(items[1]); i.push(items[2]);
		var items = checkSettingbox(thisname, desc[2], ["System.String", , "Creature Type", , "transport"], "transportable creature type"); v.push(items[1]); i.push(items[2]);
		var r1 = v[0], r2 = v[1];
		if (r1 !== "Any Region") {
			r1 = (regionCodeToDisplayName[v[0]] || "") + " / " + (regionCodeToDisplayNameSaint[v[0]] || "");
			r1 = r1.replace(/^\s\/\s|\s\/\s$/g, "");
			if (r1 === "")
				throw new TypeError(thisname + ": error, region \"" + v[0] + "\" not found in regionCodeToDisplayName[]");
		}
		if (r2 !== "Any Region") {
			r2 = (regionCodeToDisplayName[v[1]] || "") + " / " + (regionCodeToDisplayNameSaint[v[1]] || "");
			r2 = r2.replace(/^\s\/\s|\s\/\s$/g, "");
			if (r2 === "")
				throw new TypeError(thisname + ": error, region \"" + v[1] + "\" not found in regionCodeToDisplayName[]");
		}
		if (creatureNameToDisplayTextMap[v[2]] === undefined)
			throw new TypeError(thisname + ": error, creature type \"" + v[2] + "\" not found in creatureNameToDisplayTextMap[]");
		if (!BingoEnum_Transportable.includes(v[2]))
			throw new TypeError(thisname + ": error, creature type \"" + v[2] + "\" not Transportable");
		var p = [
			{ type: "icon", value: creatureNameToIconAtlasMap[v[2]], scale: 1, color: entityToColor(v[2]), rotation: 0 },
			{ type: "break" }
		];
		if (p[0].value === undefined || p[0].color === undefined)
			throw new TypeError(thisname + ": error, token \"" + v[2] + "\" not found in itemNameToIconAtlasMap[] or Color");
		if (v[0] !== "Any Region") p.push( { type: "text", value: v[0], color: RainWorldColors.Unity_white } );
		p.push( { type: "icon", value: "singlearrow", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
		if (v[1] !== "Any Region") p.push( { type: "text", value: v[1], color: RainWorldColors.Unity_white } );
		var b = Array(6); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(v[0], "regions");
		b[4] = enumToValue(v[1], "regions");
		b[5] = enumToValue(v[2], "transport");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Transporting creatures",
			items: i,
			values: v,
			description: "Transport " + entityNameQuantify(1, v[2]) + " from " + r1 + " to " + r2,
			comments: "When a specific 'From' region is selected, that creature can also be brought in from an outside region, placed on the ground, then picked up in that region, to activate it for the goal. Note: keeping a swallowable creature always in stomach will NOT count in this way, nor will throwing it up and only holding in hand, but not dropping then grabbing.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoUnlockChallenge: function(desc) {
		const thisname = "BingoUnlockChallenge";
		//	desc of format ["System.String|SingularityBomb|Unlock|0|unlocks", "0", "0"]
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Unlock", , "unlocks"], "unlock selection");
		var iconName = "", iconColor = [];
		var p = [
			{ type: "icon", value: "arenaunlock", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
			{ type: "break" }
		];
		var d = "Get the ", r;
		if (BingoEnum_ArenaUnlocksBlue.includes(items[1])) {
			p[0].color = RainWorldColors.AntiGold;
			iconName = creatureNameToIconAtlasMap[items[1]] || itemNameToIconAtlasMap[items[1]];
			iconColor = creatureNameToIconColorMap[items[1]] || itemNameToIconColorMap[items[1]] || creatureNameToIconColorMap["Default"];
			r = creatureNameToDisplayTextMap[items[1]] || itemNameToDisplayTextMap[items[1]];
			if (iconName === undefined || r === undefined)
				throw new TypeError(thisname + ": error, token \"" + items[1] + "\" not found in itemNameToIconAtlasMap[] (or creature-, or Color or DisplayText)");
			d += r;
		} else if (BingoEnum_ArenaUnlocksGold.includes(items[1])) {
			p[0].color = RainWorldColors.TokenDefault;
			r = (regionCodeToDisplayName[items[1]] || "") + " / " + (regionCodeToDisplayNameSaint[items[1]] || "");
			r = r.replace(/^\s\/\s|\s\/\s$/g, "");
			if (r === "") {
				r = arenaUnlocksGoldToDisplayName[items[1]];
				if (r === undefined)
					throw new TypeError(thisname + ": error, arena \"" + items[1] + "\" not found in arenaUnlocksGoldToDisplayName[]");
			}
			d += r + " Arenas";
		} else if (BingoEnum_ArenaUnlocksGreen.includes(items[1])) {
			p[0].color = RainWorldColors.GreenColor;
			iconName = "Kill_Slugcat";
			iconColor = RainWorldColors["Slugcat_" + items[1]];
			if (iconColor === undefined)
				throw new TypeError(thisname + ": error, token \"Slugcat_" + items[1] + "\" not found in RainWorldColors[]");
			d += items[1] + " character"
		} else if (BingoEnum_ArenaUnlocksRed.includes(items[1])) {
			p[0].color = RainWorldColors.RedColor;
			r = items[1].substring(0, items[1].search("-"));
			r = (regionCodeToDisplayName[r] || "") + " / " + (regionCodeToDisplayNameSaint[r] || "");
			r = r.replace(/^\s\/\s|\s\/\s$/g, "");
			if (r === "")
				throw new TypeError(thisname + ": error, region \"" + items[1].substring(0, items[1].search("-")) + "\" not found in regionCodeToDisplayName[]");
			d += r + " Safari";
		} else {
			throw new TypeError(thisname + ": error, token \"" + items[1] + "\" not found in BingoEnum_ArenaUnlocks[]");
		}
		if (iconName === "")
			p.push( { type: "text", value: items[1], color: RainWorldColors.Unity_white } );
		else
			p.push( { type: "icon", value: iconName, scale: 1, color: iconColor, rotation: 0 } );
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, enumToValue(items[1], "unlocks"));
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Getting Arena Unlocks",
			items: ["Unlock"],
			values: [items[1]],
			description: d + " unlock.",
			comments: "",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoVistaChallenge: function(desc) {
		const thisname = "BingoVistaChallenge";
		//	desc of format ["CC", "System.String|CC_A10|Room|0|vista", "734", "506", "0", "0"]
		checkDescriptors(thisname, desc.length, 6, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.String", , "Room", , "vista"], "item selection");
		//	desc[0] is region code
		if (desc[0] != regionOfRoom(items[1]))
			throw new TypeError(thisname + ": error, region \"" + desc[0] + "\" does not match room \"" + items[1] + "\"'s region");
		var v = (regionCodeToDisplayName[desc[0]] || "") + " / " + (regionCodeToDisplayNameSaint[desc[0]] || "");
		v = v.replace(/^\s\/\s|\s\/\s$/g, "");
		if (v === "")
			throw new TypeError(thisname + ": error, region \"" + desc[0] + "\" not found in regionCodeToDisplayName[]");
		var roomX = parseInt(desc[2]);
		if (isNaN(roomX) || roomX < 0 || roomX > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + desc[2] + "\" not a number or out of range");
		var roomY = parseInt(desc[3]);
		if (isNaN(roomY) || roomY < 0 || roomY > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + desc[3] + "\" not a number or out of range");
		var idx = BingoEnum_VistaPoints.findIndex(o => o.room == items[1] && o.x == roomX && o.y == roomY);
		if (idx < 0) {
			//	Can't find in list, customize it
			var b = Array(8); b.fill(0);
			b[0] = challengeValue(thisname);
			b[3] = enumToValue(desc[0], "regions");
			applyShort(b, 4, roomX);
			applyShort(b, 6, roomY);
			b = b.concat([...new TextEncoder().encode(items[1])]);
			b[2] = b.length - GOAL_LENGTH;
		} else {
			//	Use stock list for efficiency
			var b = Array(4); b.fill(0);
			b[0] = challengeValue("BingoVistaChallenge") + 1;
			b[3] = idx + 1;
			b[2] = b.length - GOAL_LENGTH;
		}
		return {
			name: thisname,
			category: "Visiting Vistas",
			items: ["Region"],
			values: [desc[0]],
			description: "Reach the vista point in " + v + ".",
			comments: "Room: " + items[1] + " at x: " + String(roomX) + ", y: " + String(roomY) + "; is a " + ((idx >= 0) ? "stock" : "customized") + " location." + getMapLink(items[1]) + "<br>Note: the room names for certain Vista Points in Spearmaster/Artificer Garbage Wastes, and Rivulet Underhang, are not generated correctly for their world state, and so may not show correctly on the map; the analogous rooms are however fixed up in-game.",
			paint: [
				{ type: "icon", value: "vistaicon", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: desc[0], color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	//	Challenges are alphabetical up to here (initial version); new challenges/variants added chronologically below
	//	added 0.86 (in 0.90 update cycle)
	BingoEnterRegionFromChallenge: function(desc) {
		const thisname = "BingoEnterRegionFromChallenge";
		//	desc of format ["System.String|GW|From|0|regionsreal", "System.String|SH|To|0|regionsreal", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "From", , "regionsreal"], "from region");
		var r1 = (regionCodeToDisplayName[items[1]] || "") + " / " + (regionCodeToDisplayNameSaint[items[1]] || "");
		r1 = r1.replace(/^\s\/\s|\s\/\s$/g, "");
		if (r1 === "")
			throw new TypeError(thisname + ": error, from-region \"" + items[1] + "\" not found in regionCodeToDisplayName[]");
		var itemTo = checkSettingbox(thisname, desc[1], ["System.String", , "To", , "regionsreal"], "to region");
		var r2 = (regionCodeToDisplayName[itemTo[1]] || "") + " / " + (regionCodeToDisplayNameSaint[itemTo[1]] || "");
		r2 = r2.replace(/^\s\/\s|\s\/\s$/g, "");
		if (r2 === "")
			throw new TypeError(thisname + ": error, to-region \"" + itemTo[1] + "\" not found in regionCodeToDisplayName[]");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "regionsreal");
		b[4] = enumToValue(itemTo[1], "regionsreal");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Entering a region from another region",
			items: [items[2], itemTo[2]],
			values: [items[1], itemTo[1]],
			description: "First time entering " + r2 + " must be from " + r1 + ".",
			comments: "",
			paint: [
				{ type: "text", value: items[1], color: RainWorldColors.Unity_white },
				{ type: "break" },
				{ type: "icon", value: "keyShiftA", scale: 1, color: RainWorldColors.EnterFrom, rotation: 180 },
				{ type: "break" },
				{ type: "text", value: itemTo[1], color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoMoonCloakChallenge: function(desc) {
		const thisname = "BingoMoonCloakChallenge";
		//	desc of format ["System.Boolean|false|Deliver|0|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.Boolean", , "Deliver", , "NULL"], "delivery flag");
		if (items[1] !== "true" && items[1] !== "false")
			throw new TypeError(thisname + ": error, delivery flag \"" + items[1] + "\" not 'true' or 'false'");
		var p = [ { type: "icon", value: "Symbol_MoonCloak", scale: 1, color: itemNameToIconColorMap["MoonCloak"], rotation: 0 } ];
		if (items[1] === "true") {
			p.push( { type: "icon", value: "singlearrow", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
			p.push( { type: "icon", value: "GuidanceMoon", scale: 1, color: RainWorldColors["GuidanceMoon"], rotation: 0 } );
		}
		var b = Array(3); b.fill(0);
		b[0] = challengeValue(thisname);
		applyBool(b, 1, 4, items[1]);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Moon's Cloak",
			items: [items[2]],
			values: [items[1]],
			description: ((items[1] === "false") ? "Obtain Moon's Cloak" : "Deliver the Cloak to Moon"),
			comments: "With only a 'Deliver' goal on the board, players will spawn with the Cloak in the starting shelter, and must deliver it to Looks To The Moon. If both Obtain and Deliver are present, players must obtain the Cloak from Submerged Superstructure first, and then deliver it.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoBroadcastChallenge: function(desc) {
		const thisname = "BingoBroadcastChallenge";
		//	desc of format ["System.String|Chatlog_SI3|Broadcast|0|chatlogs", "0", "0"]
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Broadcast", , "chatlogs"], "broadcast selection");
		var iconName = "", iconColor = [];
		var r = items[1].substring(items[1].search("_") + 1);
		if (r.search(/[0-9]/) >= 0) r = r.substring(0, r.search(/[0-9]/));
		r = (regionCodeToDisplayName[r] || "");
		if (r > "") r = " in " + r;
		if (enumToValue(items[1], "chatlogs") <= 0)
			throw new TypeError(thisname + ": error, chatlog \"" + items[1] + "\" not found in BingoEnum_Chatlogs[]");
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "chatlogs");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Getting Chat Logs",
			items: ["Broadcast"],
			values: [items[1]],
			description: "Get the " + items[1] + " chat log" + r,
			comments: "",
			paint: [
				{ type: "icon", value: "Symbol_Satellite", scale: 1, color: RainWorldColors.WhiteColor, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: items[1], color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	/*	added 1.091:
	 *	Stubs to maintain extended CHALLENGE_DEFINITIONS entries.
	 *	See binGoalToText() and ChallengeUpgrades[]; these names are
	 *	replaced with their originals to maintain compatibility.  */
	BingoDamageExChallenge: function(desc) {
		return CHALLENGES.BingoDamageChallenge(desc);
	},
	BingoTameExChallenge: function(desc) {
		return CHALLENGES.BingoTameChallenge(desc);
	},
};


/* * * Enum Arrays and Maps * * */

/**
 *	Possible Passages (achievements); used by BingoAchievementChallenge
 *	Game extract: WinState::PassageDisplayName
 */
const passageToDisplayNameMap = {
	"Survivor":     "The Survivor",
	"Hunter":       "The Hunter",
	"Saint":        "The Saint",
	"Traveller":    "The Wanderer",
	"Chieftain":    "The Chieftain",
	"Monk":         "The Monk",
	"Outlaw":       "The Outlaw",
	"DragonSlayer": "The Dragon Slayer",
	"Scholar":      "The Scholar",
	"Friend":       "The Friend",
	"Nomad":        "The Nomad",
	"Martyr":       "The Martyr",
	"Pilgrim":      "The Pilgrim",
	"Mother":       "The Mother"
};

/**
 *	Stealable items; used by BingoStealChallenge
 *	Value type: internal item name
 */
const BingoEnum_theft = [
	//	ChallengeUtils.stealableStoable
	"Spear",
	"Rock",
	"ScavengerBomb",
	"Lantern",
	"GooieDuck",
	"GlowWeed",
	"DataPearl"	//	added by GetCorrectListForChallenge()
];

/**
 *	Expedition items; used by BingoItemHoardChallenge
 *	Value type: internal item name
 */
const BingoEnum_Storable = [
	"FirecrackerPlant",
	"SporePlant",
	"FlareBomb",
	"FlyLure",
	"JellyFish",
	"Lantern",
	"Mushroom",
	"PuffBall",
	"ScavengerBomb",
	"VultureMask",
	"DangleFruit",	//	foods added 1.04
	"SlimeMold",
	"BubbleGrass",	//	more items/foods added 1.2; change name from expobject to Storable
	"GooieDuck",
	"LillyPuck",
	"DandelionPeach"
];

/**
 *	Weapon items; used by BingoKillChallenge
 *	Value type: internal item name
 *	Special case: element [0] is used literally (display text)
 *	Special case: weaponsnojelly removes JellyFish item
 */
const BingoEnum_Weapons = [
	//	ChallengeUtils.Weapons
	"Any Weapon",
	"Spear",
	"Rock",
	"ScavengerBomb",
	"JellyFish",
	"PuffBall",
	"LillyPuck"
];

/**
 *	Don't-use-able items; used by BingoDontUseItemChallenge
 *	Value type: internal item name
 */
const BingoEnum_Bannable = [
	//	ChallengeUtils.Bannable
	"Lantern",
	"PuffBall",
	"VultureMask",
	"ScavengerBomb",
	"FirecrackerPlant",
	"BubbleGrass",
	"Rock",
	"DataPearl"	//	added 1.2
];

/**
 *	Tame-able creatures; used by BingoTameChallenge
 *	Value type: internal creature name
 */
const BingoEnum_Befriendable = [
	//	ChallengeUtils.Befriendable
	"CicadaA",
	"CicadaB",
	"GreenLizard",
	"PinkLizard",
	"YellowLizard",
	"BlackLizard",
	"CyanLizard",
	"WhiteLizard",
	"BlueLizard",
	"EelLizard",
	"SpitLizard",
	"ZoopLizard",
	"Salamander",	//	added 0.9
	"RedLizard" 	//	added 0.99
];

/**
 *	Craftable items; used by BingoCraftChallenge
 *	Value type: internal item name
 */
const BingoEnum_CraftableItems = [
	//	ChallengeUtils.CraftableItems
	"FlareBomb",
	"SporePlant",
	"ScavengerBomb",
	"JellyFish",
	"DataPearl",
	"BubbleGrass",
	"FlyLure",
	"SlimeMold",
	"FirecrackerPlant",
	"PuffBall",
	"Mushroom",
	"Lantern",
	"GlowWeed",
	"GooieDuck",
	"FireEgg",
	//	1.2: add all remaining possibilities from the crafting table
	"VultureMask",
	"NeedleEgg",
	"KarmaFlower",
	"SingularityBomb",
	"OverseerCarcass",
	"SSOracleSwarmer",
	"Seed",
	"LillyPuck",
	"Fly",
	"SmallCentipede",
	"VultureGrub",
	"SmallNeedleWorm",
	"Hazer",
	"TubeWorm",
	"Snail"
];

/**
 *	Edible items; used by BingoEatChallenge
 *	Value type: internal item or creature name
 */
const BingoEnum_FoodTypes = [
	//	ChallengeUtils.FoodTypes
	"DangleFruit",
	"EggBugEgg",
	"WaterNut",
	"SlimeMold",
	"JellyFish",
	"Mushroom",
	"GooieDuck",
	"LillyPuck",
	"DandelionPeach",
	"GlowWeed",
	"VultureGrub",
	"Hazer",
	"SmallNeedleWorm",
	"Fly",
	"SmallCentipede",
	"SSOracleSwarmer",	//	added 1.2
	//	1.2: add remaining possibilities (see: IPlayerEdible references)
	"KarmaFlower",
	"FireEgg",
	//	Watcher-proofing?
	//"Barnacle",
	//"FireSpriteLarva",
	//"Rat",
	//"SandGrub",
	//"Tardigrade"
];

/**
 *	Convert region code to display name.
 *	From: https://rainworld.miraheze.org/wiki/User:Alphappy/Region_codes
 */
const regionCodeToDisplayName = {
	"CC": "Chimney Canopy",
	"DM": "Looks to the Moon",
	"DS": "Drainage System",
	"GW": "Garbage Wastes",
	"HI": "Industrial Complex",
	"LC": "Metropolis",
	"LF": "Farm Arrays",
	"LM": "Waterfront Facility",
	"MS": "Submerged Superstructure",
	"OE": "Outer Expanse",
	"RM": "The Rot",
	"SB": "Subterranean",
	"SH": "Shaded Citadel",
	"SI": "Sky Islands",
	"SL": "Shoreline",
	"SS": "Five Pebbles",
	"SU": "Outskirts",
	"UW": "The Exterior",
	"VS": "Pipeyard",
	"UNKNOWN": "UNKNOWN"
};

/**
 *	Convert region code to display name, Saint world state.
 *	From: https://rainworld.miraheze.org/wiki/User:Alphappy/Region_codes
 */
const regionCodeToDisplayNameSaint = {
	"CC": "Solitary Towers",
	"CL": "Silent Construct",
	"GW": "Glacial Wasteland",
	"HI": "Icy Monument",
	"HR": "Rubicon",
	"LF": "Desolate Fields",
	"SB": "Primordial Underground",
	"SI": "Windswept Spires",
	"SL": "Frigid Coast",
	"SU": "Suburban Drifts",
	"UG": "Undergrowth",
	"VS": "Barren Conduits"
};

const BingoEnum_AllRegionCodes = [
	"Any Region",
	"CC", "CL", "DM", "DS",
	"GW", "HI", "HR", "LC",
	"LF", "LM", "MS", "OE",
	"RM", "SB", "SH", "SI",
	"SL", "SS", "SU", "UG",
	"UW", "VS"
];

/**
 *	All subregions; concatenation of BingoEnum_Subregions and
 *	BingoEnum_SubregionsSaint, sorted alphabetically, duplicates removed.
 *	Value type: string, display text
 */
const BingoEnum_AllSubregions = [
	"Any Subregion",
	"...",
	"???",
	"12th Council Pillar, the House of Braids",
	"Ancient Labyrinth",
	"Atop the Tallest Tower",
	"Auxiliary Transmission Array",
	"Barren Conduits",
	"Bitter Aerie",
	"Chimney Canopy",
	"Communications Array",
	"Depths",
	"Desolate Canal",
	"Desolate Fields",
	"Drainage System",
	"Facility Roots (Western Intake)",
	"Farm Arrays",
	"Filtration System",
	"Five Pebbles",
	"Five Pebbles (General Systems Bus)",
	"Five Pebbles (Linear Systems Rail)",
	"Five Pebbles (Memory Conflux)",
	"Five Pebbles (Primary Cortex)",
	"Five Pebbles (Recursive Transform Array)",
	"Five Pebbles (Unfortunate Development)",
	"Forgotten Conduit",
	"Frigid Coast",
	"Frosted Cathedral",
	"Frozen Mast",
	"Garbage Wastes",
	"Glacial Wasteland",
	"Icy Monument",
	"Industrial Complex",
	"Journey's End",
	"Looks to the Moon",
	"Looks to the Moon (Abstract Convergence Manifold)",
	"Looks to the Moon (Memory Conflux)",
	"Looks to the Moon (Neural Terminus)",
	"Looks to the Moon (Vents)",
	"Luna",
	"Memory Crypts",
	"Metropolis",
	"Outer Expanse",
	"Outskirts",
	"Pipeyard",
	"Primordial Underground",
	"Shaded Citadel",
	"Shoreline",
	"Silent Construct",
	"Sky Islands",
	"Solitary Towers",
	"Struts",
	"Submerged Superstructure",
	"Submerged Superstructure (The Heart)",
	"Submerged Superstructure (Vents)",
	"Subterranean",
	"Suburban Drifts",
	"Sump Tunnel",
	"Sunken Pier",
	"The Floor",
	"The Gutter",
	"The Husk",
	"The Leg",
	"The Precipice",
	"The Rot",
	"The Rot (Cystic Conduit)",
	"The Rot (Depths)",
	"The Shell",
	"The Wall",
	"Undergrowth",
	"Underhang",
	"Waterfront Facility",
	"Windswept Spires"
];

/**
 *	Creatures that can be dropped in the Depths pit; used by BingoDepthsChallenge
 *	Value type: string, creature internal name
 */
const BingoEnum_Depthable = [
	"Hazer",
	"VultureGrub",
	"SmallNeedleWorm",
	"TubeWorm",
	"SmallCentipede",
	"Snail",
	"LanternMouse"
];

/**
 *	Transportable creature targets; used by BingoTransportChallenge
 *	Value type: string, creature internal name
 */
const BingoEnum_Transportable = [
	"JetFish",
	"Hazer",
	"VultureGrub",
	"CicadaA",
	"CicadaB",
	"Yeek"
];

/**
 *	Pinnable creature targets; used by BingoPinChallenge
 *	Value type: string, creature internal name
 */
const BingoEnum_Pinnable = [
	"CicadaA",
	"CicadaB",
	"Scavenger",
	"BlackLizard",
	"PinkLizard",
	"BlueLizard",
	"YellowLizard",
	"WhiteLizard",
	"GreenLizard",
	"Salamander",
	"Dropbug",
	"Snail",
	"Centipede",
	"Centiwing",
	"LanternMouse"
];

/**
 *	Bombable toll targets; used by BingoBombTollChallenge
 *	Value type: string, room name (lowercased)
 */
const BingoEnum_BombableOutposts = [
	"su_c02",
	"gw_c05",
	"gw_c11",
	"lf_e03",
	"ug_toll"
];

/**
 *	Arena unlocks, blue (item/creature); used by BingoUnlockChallenge
 *	Value type: string, unlock internal name
 */
const BingoEnum_ArenaUnlocksBlue = [
	"AquaCenti",
	"BigCentipede",
	"BigEel",
	"BigJelly",
	"BigNeedleWorm",
	"BigSpider",
	"BlackLizard",
	"BlueLizard",
	"BrotherLongLegs",
	"BubbleGrass",
	"Centiwing",
	"CicadaA",
	"CyanLizard",
	"DaddyLongLegs",
	"DandelionPeach",
	"DangleFruit",
	"Deer",
	"DropBug",
	"EelLizard",
	"EggBug",
	"ElectricSpear",
	"FireSpear",
	"FirecrackerPlant",
	"FlareBomb",
	"FlyLure",
	"GlowWeed",
	"GooieDuck",
	"Hazer",
	"Inspector",
	"JellyFish",
	"JetFish",
	"JungleLeech",
	"KingVulture",
	"Lantern",
	"LanternMouse",
	"Leech",
	"LillyPuck",
	"MirosBird",
	"MirosVulture",
	"MotherSpider",
	"Mushroom",
	"Pearl",
	"PoleMimic",
	"PuffBall",
	"RedCentipede",
	"RedLizard",
	"Salamander",
	"Scavenger",
	"ScavengerBomb",
	"ScavengerElite",
	"SeaLeech",
	"SingularityBomb",
	"SlimeMold",
	"SlugNPC",
	"SmallCentipede",
	"Snail",
	"Spider",
	"SpitLizard",
	"SpitterSpider",
	"SporePlant",
	"TentaclePlant",
	"TerrorLongLegs",
	"TubeWorm",
	"Vulture",
	"VultureGrub",
	"VultureMask",
	"WaterNut",
	"WhiteLizard",
	"Yeek",
	"YellowLizard",
	"ZoopLizard"
];

/**
 *	Arena unlocks, gold (arenas); used by BingoUnlockChallenge
 *	Value type: string, unlock internal name
 */
const BingoEnum_ArenaUnlocksGold = [
	"CC",
	"CL",
	"DM",
	"DS",
	"GW",
	"GWold",
	"HI",
	"LC",
	"LF",
	"LM",
	"MS",
	"OE",
	"RM",
	"SB",
	"SH",
	"SI",
	"SL",
	"SU",
	"UG",
	"UW",
	"VS",
	"filter",
	"gutter"
];

/**
 *	Gold arena unlocks: additional subregion names; used by BingoUnlockChallenge
 *	Key type: string, unlock internal name
 *	Value type: string, arenas unlock display name
 */
const arenaUnlocksGoldToDisplayName = {
	"GWold": "Past Garbage Wastes",
	"filter": "Filtration System",
	"gutter": "The Gutter",
};

/**
 *	Arena unlocks, green (character); used by BingoUnlockChallenge
 *	Value type: string, unlock internal name
 */
const BingoEnum_ArenaUnlocksGreen = [
	"Artificer",
	"Gourmand",
	"Rivulet",
	"Saint",
	"Spearmaster"
];

/**
 *	Arena unlocks, red (Safari); used by BingoUnlockChallenge
 *	Value type: string, unlock internal name
 */
const BingoEnum_ArenaUnlocksRed = [
	"CC-safari",
	"CL-safari",
	"DM-safari",
	"DS-safari",
	"GW-safari",
	"HI-safari",
	"LC-safari",
	"LF-safari",
	"LM-safari",
	"MS-safari",
	"OE-safari",
	"RM-safari",
	"SB-safari",
	"SH-safari",
	"SI-safari",
	"SL-safari",
	"SS-safari",
	"SU-safari",
	"UG-safari",
	"UW-safari",
	"VS-safari"
];

var BingoEnum_AllUnlocks = BingoEnum_ArenaUnlocksBlue.concat(
			BingoEnum_ArenaUnlocksGold).concat(
			BingoEnum_ArenaUnlocksRed).concat(
			BingoEnum_ArenaUnlocksGreen);

/**
 *	Assorted color constants that don't belong to any
 *	particular object, type or class
 */
const RainWorldColors = {
	//	RainWorld (global consts?), HSL2RGB'd and mathed as needed
	"AntiGold":            "#3985d5",
	"GoldHSL":             "#d58a39",
	"GoldRGB":             "#875d2f",
	"SaturatedGold":       "#ffba5e",
	"MapColor":            "#61517a",
	//	CollectToken
	"RedColor":            "#ff0000",
	"GreenColor":          "#43d539",
	"WhiteColor":          "#878787",
	"DevColor":            "#dd00f0",
	"TokenDefault":        "#ff990c",	//	BingoUnlockChallenge::IconDataForUnlock "gold" default
	//	PlayerGraphics::DefaultSlugcatColor, prefix with "Slugcat_"
	"Slugcat_White":       "#ffffff",
	"Slugcat_Yellow":      "#ffff73",
	"Slugcat_Red":         "#ff7373",
	"Slugcat_Night":       "#17234e",
	"Slugcat_Sofanthiel":  "#17234f",
	"Slugcat_Rivulet":     "#91ccf0",
	"Slugcat_Artificer":   "#70233c",
	"Slugcat_Saint":       "#aaf156",
	"Slugcat_Spear":       "#4f2e68",
	"Slugcat_Spearmaster": "#4f2e68",	//	avoid special cases detecting "Spear" vs. "Spearmaster"
	"Slugcat_Gourmand":    "#f0c197",
	//	UnityEngine.Color, prefix with "Unity_"
	"Unity_red":           "#ff0000",
	"Unity_green":         "#00ff00",
	"Unity_blue":          "#0000ff",
	"Unity_white":         "#ffffff",
	"Unity_black":         "#000000",
	"Unity_yellow":        "#ffeb04",
	"Unity_cyan":          "#00ffff",
	"Unity_magenta":       "#ff00ff",
	"Unity_gray":          "#808080",
	"Unity_grey":          "#808080",
	//	Hard-coded Bingo and Expedition colors
	"ExpHidden":           "#ffc019",
	"GuidanceNeuron":      "#00ff4c",
	"GuidanceMoon":        "#ffcc4c",
	"nomscpebble":         "#72e6c4",
	"popcorn_plant":       "#68283a",
	"EnterFrom":           "#4287ff"
};

/**
 *	Convert creature value string to display text.
 *	Game extract: Expedition.ChallengeTools::CreatureName
 *	Additions patched in from creatureNameToIconAtlasMap and sorted to match
 *	Note: these are plural; see entityNameQuantify() for special handling.
 */
const creatureNameToDisplayTextMap = {
	"Slugcat":         "Slugcats",
	"GreenLizard":     "Green Lizards",
	"PinkLizard":      "Pink Lizards",
	"BlueLizard":      "Blue Lizards",
	"CyanLizard":      "Cyan Lizards",
	"RedLizard":       "Red Lizards",
	"WhiteLizard":     "White Lizards",
	"BlackLizard":     "Black Lizards",
	"YellowLizard":    "Yellow Lizards",
	"Salamander":      "Salamanders",
	"Scavenger":       "Scavengers",
	"Vulture":         "Vultures",
	"KingVulture":     "King Vultures",
	"CicadaA":         "White Squidcadas",
	"CicadaB":         "Black Squidcadas",
	"Snail":           "Snails",
	"Centiwing":       "Centiwings",
	"SmallCentipede":  "Small Centipedes",
	"Centipede":       "Large Centipedes",
	"BigCentipede":    "Overgrown Centipedes",	//	Used by unlock token
	"RedCentipede":    "Red Centipedes",
	"BrotherLongLegs": "Brother Long Legs",
	"DaddyLongLegs":   "Daddy Long Legs",
	"LanternMouse":    "Lantern Mice",
	"GarbageWorm":     "Garbage Worms",
	"Fly":             "Batflies",
	"Leech":           "Leeches",
	"SeaLeech":        "Sea Leeches",
	"JetFish":         "Jetfish",
	"BigEel":          "Leviathans",
	"Deer":            "Rain Deer",
	"TubeWorm":        "Tube Worms",
	"Spider":          "Coalescipedes",
	"BigSpider":       "Large Spiders",
	"SpitterSpider":   "Spitter Spiders",
	"MirosBird":       "Miros Birds",
	"TentaclePlant":   "Monster Kelp",
	"PoleMimic":       "Pole Mimics",
	"Overseer":        "Overseers",
	"VultureGrub":     "Vulture Grubs",
	"EggBug":          "Egg Bugs",
	"BigNeedleWorm":   "Large Noodleflies",
	"SmallNeedleWorm": "Baby Noodleflies",
	"DropBug":         "Dropwigs",
	"Hazer":           "Hazers",
	"TrainLizard":     "Train Lizards",
	"ZoopLizard":      "Strawberry Lizards",
	"EelLizard":       "Eel Lizards",
	"JungleLeech":     "Jungle Leeches",
	"TerrorLongLegs":  "Terror Long Legs",
	"MotherSpider":    "Mother Spiders",
	"StowawayBug":     "Stowaway Bugs",
	"HunterDaddy":     "Hunter Long Legs",
	"FireBug":         "Firebugs",
	"AquaCenti":       "Aquapedes",
	"MirosVulture":    "Miros Vultures",
	"ScavengerElite":  "Elite Scavengers",
	"ScavengerKing":   "King Scavengers",
	"SpitLizard":      "Caramel Lizards",
	"Inspector":       "Inspectors",
	"Yeek":            "Yeeks",
	"BigJelly":        "Large Jellyfish",
	"SlugNPC":         "Slugpups",
	"Default":         "Unknown Creatures"
};

/**
 *	Refactoring of creatureNameToIconAtlas to associative array.
 */
const creatureNameToIconAtlasMap = {
	"Slugcat":        	"Kill_Slugcat",
	"GreenLizard":    	"Kill_Green_Lizard",
	"PinkLizard":     	"Kill_Standard_Lizard",
	"BlueLizard":     	"Kill_Standard_Lizard",
	"CyanLizard":     	"Kill_Standard_Lizard",
	"RedLizard":      	"Kill_Standard_Lizard",
	"WhiteLizard":    	"Kill_White_Lizard",
	"BlackLizard":    	"Kill_Black_Lizard",
	"YellowLizard":   	"Kill_Yellow_Lizard",
	"Salamander":     	"Kill_Salamander",
	"Scavenger":      	"Kill_Scavenger",
	"Vulture":        	"Kill_Vulture",
	"KingVulture":    	"Kill_KingVulture",
	"CicadaA":        	"Kill_Cicada",
	"CicadaB":        	"Kill_Cicada",
	"Snail":          	"Kill_Snail",
	"Centiwing":      	"Kill_Centiwing",
	"SmallCentipede": 	"Kill_Centipede1",
	"Centipede":      	"Kill_Centipede2",
	"BigCentipede":     "Kill_Centipede3",	//	Used by unlock token
	"RedCentipede":   	"Kill_Centipede3",
	"BrotherLongLegs":	"Kill_Daddy",
	"DaddyLongLegs":  	"Kill_Daddy",
	"LanternMouse":   	"Kill_Mouse",
	"GarbageWorm":    	"Kill_Garbageworm",
	"Fly":            	"Kill_Bat",
	"Leech":          	"Kill_Leech",
	"SeaLeech":       	"Kill_Leech",
	"JetFish":        	"Kill_Jetfish",
	"BigEel":         	"Kill_BigEel",
	"Deer":           	"Kill_RainDeer",
	"TubeWorm":       	"Kill_Tubeworm",
	"Spider":         	"Kill_SmallSpider",
	"BigSpider":      	"Kill_BigSpider",
	"SpitterSpider":  	"Kill_BigSpider",
	"MirosBird":      	"Kill_MirosBird",
	"TentaclePlant":  	"Kill_TentaclePlant",
	"PoleMimic":      	"Kill_PoleMimic",
	"Overseer":       	"Kill_Overseer",
	"VultureGrub":    	"Kill_VultureGrub",
	"EggBug":         	"Kill_EggBug",
	"BigNeedleWorm":  	"Kill_NeedleWorm",
	"SmallNeedleWorm":	"Kill_SmallNeedleWorm",
	"DropBug":        	"Kill_DropBug",
	"Hazer":          	"Kill_Hazer",
	"TrainLizard":    	"Kill_Standard_Lizard",
	"ZoopLizard":     	"Kill_White_Lizard",
	"EelLizard":      	"Kill_Salamander",
	"JungleLeech":    	"Kill_Leech",
	"TerrorLongLegs": 	"Kill_Daddy",
	"MotherSpider":   	"Kill_BigSpider",
	"StowawayBug":    	"Kill_Stowaway",
	"HunterDaddy":    	"Kill_Slugcat",
	"FireBug":        	"Kill_FireBug",
	"AquaCenti":      	"Kill_Centiwing",
	"MirosVulture":   	"Kill_MirosBird",
	"ScavengerElite": 	"Kill_ScavengerElite",
	"ScavengerKing":  	"Kill_ScavengerKing",
	"SpitLizard":     	"Kill_Spit_Lizard",
	"Inspector":      	"Kill_Inspector",
	"Yeek":           	"Kill_Yeek",
	"BigJelly":       	"Kill_BigJellyFish",
	"SlugNPC":        	"Kill_Slugcat",
	"Default":        	"Futile_White"
};

/**
 *	Convert creature to color.
 *	Refactoring of creatureNameToIconColor() to associative array.
 *	Sorted to match creatureNameToIconAtlasMap (with defaults removed).
 *	Key type: internal creature name
 *	Value type: array, 3 elements, numeric; RGB float color
 *	Note: use colorFloatToString() to obtain HTML colors.
 */
const creatureNameToIconColorMap = {
	"Slugcat":         "#ffffff",
	"GreenLizard":     "#33ff00",
	"PinkLizard":      "#ff00ff",
	"BlueLizard":      "#0080ff",
	"CyanLizard":      "#00e8e6",
	"RedLizard":       "#e60e0e",
	"WhiteLizard":     "#ffffff",
	"BlackLizard":     "#5e5e6f",
	"YellowLizard":    "#ff9900",
	"Salamander":      "#eec7e4",
	"Vulture":         "#d4ca6f",
	"KingVulture":     "#d4ca6f",
	"CicadaA":         "#ffffff",
	"CicadaB":         "#5e5e6f",
	"Centiwing":       "#0eb23c",
	"SmallCentipede":  "#ff9900",
	"Centipede":       "#ff9900",
	"BigCentipede":    "#ff9900",	//	Used by unlock token
	"RedCentipede":    "#e60e0e",
	"BrotherLongLegs": "#74864e",
	"DaddyLongLegs":   "#0000ff",
	"Leech":           "#ae281e",
	"SeaLeech":        "#0c4cb3",
	"TubeWorm":        "#0c4cb3",
	"SpitterSpider":   "#ae281e",
	"Overseer":        "#00e8e6",
	"VultureGrub":     "#d4ca6f",
	"EggBug":          "#00ff78",
	"BigNeedleWorm":   "#ff9898",
	"SmallNeedleWorm": "#ff9898",
	"Hazer":           "#36ca63",
	"TrainLizard":     "#4c00ff",
	"ZoopLizard":      "#f3baba",
	"EelLizard":       "#05c733",
	"JungleLeech":     "#19b319",
	"TerrorLongLegs":  "#4c00ff",
	"MotherSpider":    "#19b319",
	"StowawayBug":     "#5e5e6f",
	"HunterDaddy":     "#cc7878",
	"FireBug":         "#ff7878",
	"AquaCenti":       "#0000ff",
	"MirosVulture":    "#e60e0e",
	"SpitLizard":      "#8c6633",
	"Inspector":       "#72e6c4",
	"Yeek":            "#e6e6e6",
	"BigJelly":        "#ffd9b3",
	"Default":         "#a9a4b2"
};

/**
 *	Convert items to display text.
 *	Key type: internal item name
 *	Value type: display text (English)
 *	Note: two items with intData parameters have been integrated for completeness.
 *	Append the intData parameter (if present or nonzero) to the item name.
 *	These are:
 *	"VultureMask1", "VultureMask2", "Spear1", "Spear2", "Spear3"
 */
const itemNameToDisplayTextMap = {
	//	base game, Expedition::ChallengeTools.ItemName
	"FirecrackerPlant": "Firecracker Plants",
	"FlareBomb":        "Flare Bombs",
	"FlyLure":          "Fly Lures",
	"JellyFish":        "Jellyfish",
	"Lantern":          "Scavenger Lanterns",
	"Mushroom":         "Mushrooms",
	"PuffBall":         "Puff Balls",
	"ScavengerBomb":    "Scavenger Bombs",
	"VultureMask":      "Vulture Masks",
	"VultureMask1":     "King Vulture Masks",	//	appended intData for completeness
	"VultureMask2":     "Chieftan Masks",
	//	bingo, ChallengeUtils::ChallengeTools_ItemName
	"Spear":            "Spears",
	"Spear1":           "Explosive Spears",	//	appended intData for completeness
	"Spear2":           "Electric Spears",
	"Spear3":           "Fire Spears",
	"Rock":             "Rocks",
	"SporePlant":       "Bee Hives",
	"DataPearl":        "Pearls",
	"DangleFruit":      "Blue Fruit",
	"EggBugEgg":        "Eggbug Eggs",
	"WaterNut":         "Bubble Fruit",
	"SlimeMold":        "Slime Mold",
	"BubbleGrass":      "Bubble Grass",
	"GlowWeed":         "Glow Weed",
	"DandelionPeach":   "Dandelion Peaches",
	"LillyPuck":        "Lillypucks",
	"GooieDuck":        "Gooieducks",
	//	manual adds
	"NeedleEgg":        "Noodlefly Eggs",
	"OverseerCarcass":  "Overseer Eyes",
	"KarmaFlower":      "Karma Flowers",
	//	Used by unlock tokens (why are they different :agony:)
	"ElectricSpear":    "Electric Spears",
	"FireSpear":        "Fire Spears",
	"Pearl":            "Pearls",
	//	entries in itemNameToIconAtlasMap missing from above
	"SLOracleSwarmer":  "Neuron Flies",
	"SSOracleSwarmer":  "Neuron Flies",
	"NSHSwarmer":       "Green Neuron Flies",
	"PebblesPearl":     "Pearls",
	"HalcyonPearl":     "Pearls",
	"Spearmasterpearl": "Pearls",
	"EnergyCell":       "Rarefaction Cells",
	"SingularityBomb":  "Singularity Bombs",
	"MoonCloak":        "Moon's Cloak",
	"FireEgg":          "Firebug Eggs",
	"JokeRifle":        "Joke Rifles",
	"Seed":             "Popcorn Seeds",
	"Default":          "Unknown Items"
};

/**
 *	Convert items to atlas icons.
 *	Key type: internal item name
 *	Value type: atlas icon name
 *	Sorted approximately from itemNameToIconColorMap.
 */
const itemNameToIconAtlasMap = {
	//	base game, ItemSymbol.SpriteNameForItem
	"Rock":             "Symbol_Rock",
	"SporePlant":       "Symbol_SporePlant",
	"FirecrackerPlant": "Symbol_Firecracker",
	"ScavengerBomb":    "Symbol_StunBomb",
	"Spear":            "Symbol_Spear",
	"Spear1":           "Symbol_FireSpear",
	"Spear2":           "Symbol_ElectricSpear",
	"Spear3":           "Symbol_HellSpear",
	"Lantern":          "Symbol_Lantern",
	"FlareBomb":        "Symbol_FlashBomb",
	"PuffBall":         "Symbol_PuffBall",
	"SlimeMold":        "Symbol_SlimeMold",
	"BubbleGrass":      "Symbol_BubbleGrass",
	"DangleFruit":      "Symbol_DangleFruit",
	"Mushroom":         "Symbol_Mushroom",
	"WaterNut":         "Symbol_WaterNut",
	"EggBugEgg":        "Symbol_EggBugEgg",
	"FlyLure":          "Symbol_FlyLure",
	"JellyFish":        "Symbol_JellyFish",
	"VultureMask":      "Kill_Vulture",
	"VultureMask1":     "Kill_KingVulture",
	"VultureMask2":     "Symbol_ChieftainMask",
	"SLOracleSwarmer":  "Symbol_Neuron",
	"SSOracleSwarmer":  "Symbol_Neuron",
	"NSHSwarmer":       "Symbol_Neuron",
	"NeedleEgg":        "needleEggSymbol",
	"OverseerCarcass":  "Kill_Overseer",
	"PebblesPearl":     "Symbol_Pearl",
	"DataPearl":        "Symbol_Pearl",
	"HalcyonPearl":     "Symbol_Pearl",
	"Spearmasterpearl": "Symbol_Pearl",
	"EnergyCell":       "Symbol_EnergyCell",
	"SingularityBomb":  "Symbol_Singularity",
	"GooieDuck":        "Symbol_GooieDuck",
	"LillyPuck":        "Symbol_LillyPuck",
	"GlowWeed":         "Symbol_GlowWeed",
	"DandelionPeach":   "Symbol_DandelionPeach",
	"MoonCloak":        "Symbol_MoonCloak",
	"FireEgg":          "Symbol_FireEgg",
	"JokeRifle":        "Symbol_JokeRifle",
	"Seed":             "Symbol_Seed",
	"Default":          "Futile_White",
	//	Used by unlock tokens
	"FireSpear":        "Symbol_FireSpear",
	"ElectricSpear":    "Symbol_ElectricSpear",
	"Pearl":            "Symbol_Pearl"
};

/**
 *	Colored data pearl types, indexed by intData parameter
 *	Use to convert pearl index to expanded text name, for use with:
 *	dataPearlToDisplayTextMap[DataPearlList[intData]] and,
 *	dataPearlToColorMap[DataPearlList[intData]] or
 *	itemNameToIconColorMap["Pearl_" + DataPearlList[intData]]
 */
const DataPearlList = [
	,
	,
	//	From DataPearl::AbstractDataPearl.DataPearlType
	"Misc",
	"Misc2",
	"CC",
	"SI_west",
	"SI_top",
	"LF_west",
	"LF_bottom",
	"HI",
	"SH",
	"DS",
	"SB_filtration",
	"SB_ravine",
	"GW",
	"SL_bridge",
	"SL_moon",
	"SU",
	"UW",
	"PebblesPearl",
	"SL_chimney",
	"Red_stomach",
	//	from MoreSlugcats::MoreSlugcatsEnums::DataPearlType.RegisterValues()
	"Spearmasterpearl",
	"SU_filt",
	"SI_chat3",
	"SI_chat4",
	"SI_chat5",
	"DM",
	"LC",
	"OE",
	"MS",
	"RM",
	"Rivulet_stomach",
	"LC_second",
	"CL",
	"VS",
	"BroadcastMisc"
];

/**
 *	Pearl display names.
 *	Key type: internal pearl name
 *	Value type: display name
 *	Note: use colorFloatToString() to obtain HTML colors.
 */
const dataPearlToDisplayTextMap = {
	//	Bingo, ChallengeUtils::NameForPearl()
	"CC":               "Gold",
	"DS":               "Bright Green",
	"GW":               "Viridian",
	"HI":               "Bright Blue",
	"LF_bottom":        "Bright Red",
	"LF_west":          "Deep Pink",
	"SH":               "Deep Magenta",
	"SI_chat3":         "Dark Purple",
	"SI_chat4":         "Olive Green",
	"SI_chat5":         "Dark Magenta",
	"SI_top":           "Dark Blue",
	"SI_west":          "Dark Green",
	"SL_bridge":        "Bright Purple",
	"SL_chimney":       "Bright Magenta",
	"SL_moon":          "Pale Yellow",
	"SB_filtration":    "Teal",
	"SB_ravine":        "Dark Magenta",
	"SU":               "Light Blue",
	"UW":               "Pale Green",
	"VS":               "Deep Purple",
	//	Additional names from Wiki
	"CL":               "Music (faded)",
	"DM":               "Light Yellow",
	"LC":               "Deep Green",
	"LC_second":        "Bronze",
	"MS":               "Dull Yellow",
	"OE":               "Light Purple",
	"Red_stomach":      "Aquamarine",
	"Rivulet_stomach":  "Celadon",
	"RM":               "Music",
	"Spearmasterpearl": "Dark Red",
	"SU_filt":          "Light Pink",
	//	Unused, to match parity with DataPearlList
	"BroadcastMisc":    "Broadcast",
	"Misc":             "Misc",
	"Misc2":            "Misc 2",
	"PebblesPearl":     "Active Processes"
};

/**
 *	Pearl region codes.
 *	Key type: internal pearl name
 *	Value type: region code
 *	Note: "DM" maps to "MS" by default, but "DM" for Spearmaster.
 */
const dataPearlToRegionMap = {
	"CC":               "CC",
	"DS":               "DS",
	"GW":               "GW",
	"HI":               "HI",
	"LF_bottom":        "LF",
	"LF_west":          "LF",
	"SH":               "SH",
	"SI_chat3":         "SI",
	"SI_chat4":         "SI",
	"SI_chat5":         "SI",
	"SI_top":           "SI",
	"SI_west":          "SI",
	"SL_bridge":        "SL",
	"SL_chimney":       "SL",
	"SL_moon":          "SL",
	"SB_filtration":    "SB",
	"SB_ravine":        "SB",
	"SU":               "SU",
	"UW":               "UW",
	"VS":               "VS",
	"CL":               "CL",
	"DM":               "MS",	//	special case: Spear only: DM
	"LC":               "LC",
	"LC_second":        "LC",
	"MS":               "GW",
	"OE":               "OE",
	"RM":               "RM",
	"SU_filt":          "SU",
	//	Should never happen
	"BroadcastMisc":    "UNKNOWN",
	"Misc":             "UNKNOWN",
	"Misc2":            "UNKNOWN",
	"PebblesPearl":     "UNKNOWN",
	"Red_stomach":      "UNKNOWN",
	"Rivulet_stomach":  "UNKNOWN",
	"Spearmasterpearl": "UNKNOWN"
};

/**
 *	Pearl colors.
 *	Key type: internal pearl name
 *	Value type: array, 3 elements, numeric; RGB float color
 *	Note: use colorFloatToString() to obtain HTML colors.
 */
const dataPearlToColorMap = {
	"Misc":             "#bebebe",
	"Misc2":            "#bebebe",
	"CC":               "#f3cc19",
	"SI_west":          "#0d412c",
	"SI_top":           "#0d2c41",
	"LF_west":          "#ff2667",
	"LF_bottom":        "#ff3c3c",
	"HI":               "#215bff",
	"SH":               "#851450",
	"DS":               "#26be3c",
	"SB_filtration":    "#3c9393",
	"SB_ravine":        "#410d2c",
	"GW":               "#20c690",
	"SL_bridge":        "#9435ee",
	"SL_moon":          "#eaf551",
	"SU":               "#93a8ea",
	"UW":               "#7da47d",
	"PebblesPearl":     "#bebebe",
	"SL_chimney":       "#ff1ab5",
	"Red_stomach":      "#99ffe6",
	"Spearmasterpearl": "#7e020a",
	"SU_filt":          "#ffc9ea",
	"SI_chat3":         "#2c0d41",
	"SI_chat4":         "#2c410d",
	"SI_chat5":         "#410d2c",
	"DM":               "#f6ee53",
	"LC":               "#267d29",
	"OE":               "#9d76d4",
	"MS":               "#d7e861",
	"RM":               "#b12ffb",
	"Rivulet_stomach":  "#a6e3ae",
	"LC_second":        "#c26600",
	"CL":               "#bd48ff",
	"VS":               "#c30cf5",
	"BroadcastMisc":    "#e9c6d2"
};

/**
 *	Complete list of items' colors, including pearls.
 *	Key type: internal item name, or pearl name with "Pearl_" prepended.
 *	Value type: HTML color.
 *	Any items not found in this list, shall use "Default"'s value instead.
 */
const itemNameToIconColorMap = {
	"Default":                "#a9a4b2",
	"SporePlant":             "#ae281e",
	"FirecrackerPlant":       "#ae281e",
	"ScavengerBomb":          "#e60e0e",
	"Spear1":                 "#e60e0e",
	"Spear2":                 "#0000ff",
	"Spear3":                 "#ff7878",
	"Lantern":                "#ff9251",
	"FlareBomb":              "#bbaeff",
	"SlimeMold":              "#ff9900",
	"BubbleGrass":            "#0eb23c",
	"DangleFruit":            "#0000ff",
	"Mushroom":               "#ffffff",
	"WaterNut":               "#0c4cb3",
	"EggBugEgg":              "#00ff78",
	"FlyLure":                "#ad4436",
	"SSOracleSwarmer":        "#ffffff",
	"NSHSwarmer":             "#00ff4c",
	"NeedleEgg":              "#932940",
	"PebblesPearl1":          "#b3b3b3",
	"PebblesPearl2":          "#4b4652",
	"PebblesPearl3":          "#ff7a02",
	"PebblesPearl":           "#0074a3",
	"DataPearl":              "#b3b3b3",	//	default values -- access special values by using key:
	"HalcyonPearl":           "#b3b3b3",	//	"Pearl" + DataPearlList[intData]
	"DataPearl1":             "#ff99e6",	//	intData = 1
	"Spearmasterpearl":       "#88282f",
	"EnergyCell":             "#05a5d9",
	"SingularityBomb":        "#05a5d9",
	"GooieDuck":              "#72e6c4",
	"LillyPuck":              "#2bf6ff",
	"GlowWeed":               "#f2ff44",
	"DandelionPeach":         "#97c7f5",
	"MoonCloak":              "#f3fff5",	//	"#cccccc"
	"FireEgg":                "#ff7878",
	//	Used by unlock tokens (why are they different :agony: )
	"ElectricSpear":          "#0000ff",
	"FireSpear":              "#e60e0e",
	"Pearl":                  "#b3b3b3",
	//	dataPearlToColorMap incorporated here, add "Pearl_" prefix
	"Pearl_Misc":             "#bebebe",
	"Pearl_Misc2":            "#bebebe",
	"Pearl_CC":               "#f3cc19",
	"Pearl_SI_west":          "#0d412c",
	"Pearl_SI_top":           "#0d2c41",
	"Pearl_LF_west":          "#ff2667",
	"Pearl_LF_bottom":        "#ff3c3c",
	"Pearl_HI":               "#215bff",
	"Pearl_SH":               "#851450",
	"Pearl_DS":               "#26be3c",
	"Pearl_SB_filtration":    "#3c9393",
	"Pearl_SB_ravine":        "#410d2c",
	"Pearl_GW":               "#20c690",
	"Pearl_SL_bridge":        "#9435ee",
	"Pearl_SL_moon":          "#eaf551",
	"Pearl_SU":               "#93a8ea",
	"Pearl_UW":               "#7da47d",
	"Pearl_PebblesPearl":     "#bebebe",
	"Pearl_SL_chimney":       "#ff1ab5",
	"Pearl_Red_stomach":      "#99ffe6",
	"Pearl_Spearmasterpearl": "#7e020a",
	"Pearl_SU_filt":          "#ffc9ea",
	"Pearl_SI_chat3":         "#2c0d41",
	"Pearl_SI_chat4":         "#2c410d",
	"Pearl_SI_chat5":         "#410d2c",
	"Pearl_DM":               "#f6ee53",
	"Pearl_LC":               "#267d29",
	"Pearl_OE":               "#9d76d4",
	"Pearl_MS":               "#d7e861",
	"Pearl_RM":               "#b12ffb",
	"Pearl_Rivulet_stomach":  "#a6e3ae",
	"Pearl_LC_second":        "#c26600",
	"Pearl_CL":               "#bd48ff",
	"Pearl_VS":               "#c30cf5",
	"Pearl_BroadcastMisc":    "#e9c6d2"
};

const BingoEnum_CHARACTERS = [
	"Yellow",
	"White",
	"Red",
	"Gourmand",
	"Artificer",
	"Rivulet",
	"Spear",
	"Saint",
	"Sofanthiel",
	"Night",
]

const BingoEnum_CharToDisplayText = {
	"Yellow":     "Monk",
	"White":      "Survivor",
	"Red":        "Hunter",
	"Gourmand":   "Gourmand",
	"Artificer":  "Artificer",
	"Rivulet":    "Rivulet",
	"Spear":      "Spearmaster",
	"Saint":      "Saint",
	"Sofanthiel": "Inv",
	"Night":      "Nightcat"
};

/**
 *	This is kept more for reference, or future use; prefer using challengeValue()
 *  or e.g.
 *		Object.keys(CHALLENGE_DEFINITIONS)[idx].name
 *		CHALLENGE_DEFINITIONS.findIndex(a => a.name === txt)
 *	Note that CHALLENGE_DEFINITIONS[] can contain duplicates:
 *	"BingoVistaChallenge" is one example.
 *
 *	Filled on startup by.
 */
const BingoEnum_CHALLENGES = [];

const BingoEnum_EXPFLAGS = {
	"LANTERN":   0x00000001,
	"MASK":      0x00000002,
	"BOMB":      0x00000004,
	"NEURON":    0x00000008,
	"BACKSPEAR": 0x00000010,
	"FLOWER":    0x00000020,
	"PASSAGE":   0x00000040,
	"SLOWTIME":  0x00000080,
	"SINGUBOMB": 0x00000100,
	"ELECSPEAR": 0x00000200,
	"DUALWIELD": 0x00000400,
	"EXPRESIST": 0x00000800,
	"EXPJUMP":   0x00001000,
	"CRAFTING":  0x00002000,
	"AGILITY":   0x00004000,
	"RIFLE":     0x00008000,
	"BLINDED":   0x00010000,
	"DOOMED":    0x00020000,
	"HUNTED":    0x00040000,
	"PURSUED":   0x00080000,
	"AURA":      0x00100000,
	"LOCKOUT":   0x00200000,
	"BLACKOUT":  0x00400000
};

const BingoEnum_EXPFLAGSNames = {
	"LANTERN":   "Perk: Scavenger Lantern",
	"MASK":      "Perk: Vulture Mask",
	"BOMB":      "Perk: Scavenger Bomb",
	"NEURON":    "Perk: Neuron Glow",
	"BACKSPEAR": "Perk: Back Spear",
	"FLOWER":    "Perk: Karma Flower",
	"PASSAGE":   "Perk: Enable Passages",
	"SLOWTIME":  "Perk: Slow Time",
	"SINGUBOMB": "Perk: Singularity Bomb",
	"ELECSPEAR": "Perk: Electric Spear",
	"DUALWIELD": "Perk: Spear Dual-Wielding",
	"EXPRESIST": "Perk: Explosion Resistance",
	"EXPJUMP":   "Perk: Explosive Jump",
	"CRAFTING":  "Perk: Item Crafting",
	"AGILITY":   "Perk: High Agility",
	"RIFLE":     "Perk: Joke Rifle",
	"BLINDED":   "Burden: Blinded",
	"DOOMED":    "Burden: Doomed",
	"HUNTED":    "Burden: Hunted",
	"PURSUED":   "Burden: Pursued",
	"AURA":      "Aura Enabled",
	"LOCKOUT":   "Gameplay: Lockout",
	"BLACKOUT":  "Gameplay: Blackout"
};

/**
 *	Boolean strings, for completeness.
 */
const BingoEnum_Boolean = [
	"false",
	"true"
];

/**
 *	Stock (built in / mod generated) Vista Point locations.
 */
const BingoEnum_VistaPoints = [
	//	Base Expedition
	{ region: "CC", room: "CC_A10",       x:  734, y:  506  },
	{ region: "CC", room: "CC_B12",       x:  455, y: 1383  },
	{ region: "CC", room: "CC_C05",       x:  449, y: 2330  },
	{ region: "CL", room: "CL_C05",       x:  540, y: 1213  },
	{ region: "CL", room: "CL_H02",       x: 2407, y: 1649  },
	{ region: "CL", room: "CL_CORE",      x:  471, y:  373  },
	{ region: "DM", room: "DM_LAB1",      x:  486, y:  324  },
	{ region: "DM", room: "DM_LEG06",     x:  400, y:  388  },
	{ region: "DM", room: "DM_O02",       x: 2180, y: 2175  },
	{ region: "DS", room: "DS_A05",       x:  172, y:  490  },
	{ region: "DS", room: "DS_A19",       x:  467, y:  545  },
	{ region: "DS", room: "DS_C02",       x:  541, y: 1305  },
	{ region: "GW", room: "GW_C09",       x:  607, y:  595  },
	{ region: "GW", room: "GW_D01",       x: 1603, y:  595  },
	{ region: "GW", room: "GW_E02",       x: 2608, y:  621  },
	{ region: "HI", room: "HI_B04",       x:  214, y:  615  },
	{ region: "HI", room: "HI_C04",       x:  800, y:  768  },
	{ region: "HI", room: "HI_D01",       x: 1765, y:  655  },
	{ region: "LC", room: "LC_FINAL",     x: 2700, y:  500  },
	{ region: "LC", room: "LC_SUBWAY01",  x: 1693, y:  564  },
	{ region: "LC", room: "LC_tallestconnection", x:  153, y:  242 },
	{ region: "LF", room: "LF_A10",       x:  421, y:  412  },
	{ region: "LF", room: "LF_C01",       x: 2792, y:  423  },
	{ region: "LF", room: "LF_D02",       x: 1220, y:  631  },
	{ region: "OE", room: "OE_RAIL01",    x: 2420, y: 1378  },
	{ region: "OE", room: "OE_RUINCourtYard", x: 2133, y: 1397  },
	{ region: "OE", room: "OE_TREETOP",   x:  468, y: 1782  },
	{ region: "RM", room: "RM_ASSEMBLY",  x: 1550, y:  586  },
	{ region: "RM", room: "RM_CONVERGENCE", x: 1860, y:  670  },
	{ region: "RM", room: "RM_I03",       x:  276, y: 2270  },
	{ region: "SB", room: "SB_D04",       x:  483, y: 1045  },
	{ region: "SB", room: "SB_E04",       x: 1668, y:  567  },
	{ region: "SB", room: "SB_H02",       x: 1559, y:  472  },
	{ region: "SH", room: "SH_A14",       x:  273, y:  556  },
	{ region: "SH", room: "SH_B05",       x:  733, y:  453  },
	{ region: "SH", room: "SH_C08",       x: 2159, y:  481  },
	{ region: "SI", room: "SI_C07",       x:  539, y: 2354  },
	{ region: "SI", room: "SI_D05",       x: 1045, y: 1258  },
	{ region: "SI", room: "SI_D07",       x:  200, y:  400  },
	{ region: "SL", room: "SL_B01",       x:  389, y: 1448  },
	{ region: "SL", room: "SL_B04",       x:  390, y: 2258  },
	{ region: "SL", room: "SL_C04",       x:  542, y: 1295  },
	{ region: "SU", room: "SU_A04",       x:  265, y:  415  },
	{ region: "SU", room: "SU_B12",       x: 1180, y:  382  },
	{ region: "SU", room: "SU_C01",       x:  450, y: 1811  },
	{ region: "UG", room: "UG_A16",       x:  640, y:  354  },
	{ region: "UG", room: "UG_D03",       x:  857, y: 1826  },
	{ region: "UG", room: "UG_GUTTER02",  x:  163, y:  241  },
	{ region: "UW", room: "UW_A07",       x:  805, y:  616  },
	{ region: "UW", room: "UW_C02",       x:  493, y:  490  },
	{ region: "UW", room: "UW_J01",       x:  860, y: 1534  },
	{ region: "VS", room: "VS_C03",       x:   82, y:  983  },
	{ region: "VS", room: "VS_F02",       x: 1348, y:  533  },
	{ region: "VS", room: "VS_H02",       x:  603, y: 3265  },
	//	Bingo customs/adders
	{ region: "CC", room: "CC_SHAFT0x",   x: 1525, y:  217  },
	{ region: "CL", room: "CL_C03",       x:  808, y:   37  },
	{ region: "DM", room: "DM_VISTA",     x:  956, y:  341  },
	{ region: "DS", room: "DS_GUTTER02",  x:  163, y:  241  },
	{ region: "GW", room: "GW_A24",       x:  590, y:  220  },
	{ region: "HI", room: "HI_B02",       x:  540, y: 1343  },
	{ region: "LC", room: "LC_stripmallNEW", x: 1285, y:   50  },
	{ region: "LF", room: "LF_E01",       x:  359, y:   63  },
	{ region: "LM", room: "LM_B01",       x:  248, y: 1507  },
	{ region: "LM", room: "LM_B04",       x:  503, y: 2900  },
	{ region: "LM", room: "LM_C04",       x:  542, y:  129  },
	{ region: "LM", room: "LM_EDGE02",    x: 1750, y: 1715  },
	{ region: "MS", room: "MS_AIR03",     x: 1280, y:  770  },
	{ region: "MS", room: "MS_ARTERY01",  x: 4626, y:   39  },
	{ region: "MS", room: "MS_FARSIDE",   x: 2475, y: 1800  },
	{ region: "MS", room: "MS_LAB4",      x:  390, y:  240  },
	{ region: "OE", room: "OE_CAVE02",    x: 1200, y:   35  },
	{ region: "RM", room: "RM_LAB8",      x: 1924, y:   65  },
	{ region: "SB", room: "SB_C02",       x: 1155, y:  550  },
	{ region: "SH", room: "SH_E02",       x:  770, y:   40  },
	{ region: "SI", room: "SI_C04",       x: 1350, y:  130  },
	{ region: "SL", room: "SL_AI",        x: 1530, y:   15  },
	{ region: "SS", room: "SS_A13",       x:  347, y:  595  },
	{ region: "SS", room: "SS_C03",       x:   60, y:  119  },
	{ region: "SS", room: "SS_D04",       x:  980, y:  440  },
	{ region: "SS", room: "SS_LAB12",     x:  697, y:  255  },
	{ region: "SU", room: "SU_B11",       x:  770, y:   48  },
	{ region: "UG", room: "UG_A19",       x:  545, y:   43  },
	{ region: "UW", room: "UW_D05",       x:  760, y:  220  },
	{ region: "VS", room: "VS_E06",       x:  298, y: 1421  },
	{ region: "LM", room: "LM_C04",       x:  542, y: 1295  },	//	append to fix typo in list
];

/**
 *	BingoEnum_VistaPoints entries, transposed into arrays per property.
 *	Generated on startup, see addVistaPointsToCode().
 */
const BingoEnum_VistaPoints_region = [];
const BingoEnum_VistaPoints_room = [];
const BingoEnum_VistaPoints_x = [];
const BingoEnum_VistaPoints_y = [];

const BingoEnum_EnterableGates = [
	"SU_HI", "SU_LF", "SU_DS", "HI_SU",
	"HI_CC", "HI_SH", "HI_GW", "HI_VS",
	"VS_HI", "VS_SI", "VS_SL", "VS_SB",
	"GW_HI", "GW_SL", "GW_DS", "SL_GW",
	"SL_SB", "SL_SH", "SL_VS", "SH_GW",
	"SH_HI", "SH_UW", "SH_SL", "UW_SH",
	"UW_SL", "UW_CC", "CC_UW", "CC_HI",
	"CC_DS", "CC_SI", "LF_SU", "LF_SI",
	"LF_SB", "SI_LF", "SI_CC", "SI_VS",
	"DS_SU", "DS_SB", "DS_GW", "DS_CC",
	"SB_DS", "SB_SL", "SB_VS"
];

const BingoEnum_Chatlogs = [
	"Chatlog_CC0",
	"Chatlog_DS0",
	"Chatlog_HI0",
	"Chatlog_GW0",
	"Chatlog_GW2",
	"Chatlog_GW1",
	"Chatlog_SI2",
	"Chatlog_SI5",
	"Chatlog_SI3",
	"Chatlog_SI4",
	"Chatlog_SI0",
	"Chatlog_SI1",
	"Chatlog_SH0",
	"Chatlog_SB0",
	"Chatlog_LM0",
	"Chatlog_LM1",
	"Chatlog_DM1",
	"Chatlog_DM0"
];

/**
 *	Master list/map of all enums used.
 *	Key type: list name, as used in Bingo Mod SettingBox lists.
 *	Value type: array of strings, set of creature/item internal names, tokens, region codes, etc.
 */
const ALL_ENUMS = {
	"banitem":        BingoEnum_FoodTypes.concat(BingoEnum_Bannable),
	"boolean":        BingoEnum_Boolean,
	"challenges":     BingoEnum_CHALLENGES,
	"characters":     BingoEnum_CHARACTERS,
	"chatlogs":       BingoEnum_Chatlogs,
	"craft":          BingoEnum_CraftableItems,
	"creatures":      ["Any Creature"].concat(Object.keys(creatureNameToDisplayTextMap)),
	"depths":         BingoEnum_Depthable,
	"echoes":         BingoEnum_AllRegionCodes,
	"EXPFLAGS":       Object.keys(BingoEnum_EXPFLAGS),
	"expobject":      BingoEnum_Storable,
	"food":           BingoEnum_FoodTypes,
	"friend":         BingoEnum_Befriendable,
	"gates":          BingoEnum_EnterableGates,
	"items":          Object.keys(itemNameToDisplayTextMap),
	"passage":        Object.keys(passageToDisplayNameMap),
	"pearls":         DataPearlList.slice(2),
	"pinnable":       BingoEnum_Pinnable,
	"regions":        BingoEnum_AllRegionCodes,
	"regionsreal":    BingoEnum_AllRegionCodes,
	"subregions":     BingoEnum_AllSubregions,
	"theft":          BingoEnum_theft,
	"tolls":          BingoEnum_BombableOutposts,
	"transport":      BingoEnum_Transportable,
	"unlocks":        BingoEnum_AllUnlocks,
	"vista_region":   BingoEnum_VistaPoints_region,
	"vista_room":     BingoEnum_VistaPoints_room,
	"vista_x":        BingoEnum_VistaPoints_x,
	"vista_y":        BingoEnum_VistaPoints_y,
	"weapons":        BingoEnum_Weapons,
	"weaponsnojelly": BingoEnum_Weapons
};

/**
 *	Instructions for parsing binary and text goals into abstract goal objects.
 *	Index with BingoEnum_CHALLENGES.
 *
 *	An entry requires these properties:
 *	{
 *		GoalName:     "BingoNameOfTheChallenge",
 *		params:       { param1: "default value", ... },
 *		BinDecode:    [ ],
 *		BinEncode:    function(p) { },
 *		TextDecode:   [ ],
 *		TextEncode:   function(p) { },
 *		GoalCategory: "Brief description of the goal",
 *		GoalComments: function(p) { },
 *		GoalDesc:     function(p) { },
 *		GoalPaint:    function(p) { }
 *	}
 *
 *	GoalName      A string of the form /Bingo.*Challenge/, following the
 *	              BingoChallenge class the goal is derived from.
 *	params        Object containing primitive types; names are equivalent
 *	              to fields in the basis class, values are default values.
 *	BinDecode     Array of BinDecode objects; each one references a
 *	              parameter, and describes the data type, position, and an
 *	              applicable enum (if any), to obtain that value from a
 *	              binary source.
 *	BinEncode     Function returning the encoded binary-format goal.
 *	TextDecode    List of TextDecode objects; each object references a
 *	              parameter, describing the data type and its expected
 *	              format. Position is sequential (because parameters are
 *	              delimited by "><").
 *	TextEncode    Function returning the encoded text-format goal.
 *	GoalCategory  String briefly describing the goal class.
 *	GoalComments  Function returning a string, providing commentary on the
 *	              goal if applicable (if not, returns "").
 *	GoalDesc      Brief summary of the goal's action or requirement, based
 *	              on current parameters.
 *	GoalPaint     Array of GoalPaint objects, describing how the goal
 *	              should be displayed on the board.
 *
 *	All functions pass in the parameter list p when executed.
 *
 *	--------- below is out of date ----------
 *	desc contains templates, of the form "{" + String(index) + "}", where index
 *	is the index of the params object that produces it.  Templates are expanded
 *	naively via RegExp, in order; avoid nesting them, or "interesting" results
 *	may happen.
 *
 *	The final goal string is produced as "<name>~<desc>", with desc's template sites
 *	replaced by values produced from respectively numbered params items.  Goals are
 *	joined with "bChG" to produce a complete board.
 *
 *	A params object takes the form of these structures:
 *
 *	//	Plain number: writes a decimal integer into its replacement template site(s)
 *	{
 *		type: "number",
 *		offset: 0,      	//	byte offset in goal.data, where to read from (beware: can overlap other fields!)
 *		size: 1,        	//	(1-4) number of bytes to read from binary goal, starting from offset
 *		formatter: ""   	//	Name of an enum to transform each character with, or empty for identity
 *	}
 *
 *	//	Plain string: copies a fixed-length or zero-terminated string (optionally
 *	//	transformed by formatter and joiner) into the matching position in the template
 *	//	string. Note: when formatter === "", UTF-8 decoding is applied, returning a
 *	//	normal JS string in the object.
 *	{
 *		type: "string",
 *		offset: 3,      	//	byte offset to read from
 *		size: 2,        	//	number of bytes to read, or if 0, read until zero terminator or end of goal
 *		formatter: "",  	//	Name of an enum to transform each character with
 *		joiner: ""      	//	String to join characters with
 *	}
 *
 *	//	Pointer to string: reads a (byte) offset from target location, then uses it as
 *	//	an offset (relative to goal data start) pointing to a fixed-length or zero-
 *	//	terminated string; the string is optionally transformed by formatter and joiner;
 *	//	then the result is deposited into the matching position in the template string
 *	{
 *		type: "pstr",
 *		offset: 2,    	//	byte offset to read pointer from
 *		size: 0,      	//	!= 0, length of string, or if 0, read until Z/end
 *		formatter: "",	//	Name of an enum to transform each character with
 *		joiner: ""    	//	String to join characters with
 *	}
 *
 *	//	Boolean: reads one bit at the specified offset and position, then copies the
 *	//	formatter'd value into its replacement template site(s)
 *	{
 *		type: "bool",
 *		offset: 1,   	//	byte offset (starting from goal.flags) to read from
 *		bit: 0,      	//	bit offset within byte (0-7) (note: bits 0-3 of offset 0 are reserved)
 *		formatter: ""	//	Name of an enum to transform the value (0/1) with
 *	}
 *
 *	Where a formatter is specified, a simple num:char or char:char conversion table can be
 *	used, or a multi-character output such as from a namespace enum.  In this way, a string
 *	for example can be expanded into an array of names, separated by delimiters (joiner) to
 *	represent higher-level structures like lists or dictionaries; or a number into an enum,
 *	or a boolean into "false" and "true".  number and bool are scalar so of course don't
 *	have anything to join; `joiner` is unread on those types.
 *
 *	Special note: because zero may be used for string terminator, and because enums may be
 *	used for both string (array) and scalar (number) data, the actual enum index written is
 *	someEnumArray.indexOf("someString") + 1 for both data types.  Enums with a default or
 *	"any" value shall use a default index of 0 (thus stored as 1 in the binary format).
 *
 *	Note that the last string in a goal can be terminated by the goal object itself, saving
 *	a zero terminator.  Ensure that an implementation captures this behavior safely, without
 *	committing read-beyond-bounds or uninitialized memory access.  (This is trivial to this
 *	JS implementation, but beware for porting to others.)  A recommended approach is copying
 *	the goal into a temporary buffer, that has been zeroed at least some bytes beyond the
 *	length of the goal being read.  Or use a language which returns zero or null or throws
 *	error for OoB reads.
 */
const CHALLENGE_DEFINITIONS = [
	{	//	Base class: no parameters, any desc allowed
		GoalName: "BingoChallenge",
		params: { desc: "" },
		BinDecode: [
			{ param: "desc", type: "string", offset: 0, size: 0, formatter: "" }	//	0: Unformatted string
		],
		BinEncode: function(p) {
			var enc = new TextEncoder().encode(p.desc);
			enc = enc.subarray(0, 255);
			return new Uint8Array([challengeValue("BingoChallenge"), 0, enc.length, ...enc]);
		},
		TextDecode: [
			{ param: "desc",    type: "string" },	//	0: description
			{ param: "unused",  type: "string" } 	//	1: empty field to satisfy splitting
		],
		TextEncode: function(p) {
			return p.desc + "><";
		},
		GoalCategory:  "Empty challenge class",
		GoalComments: function(p) {
			return "";
		},
		GoalDesc: function(p) {
			return p.desc;
		},
		GoalPaint: function(p) {
			return [
				{ type: "text", value: "∅", color: RainWorldColors.Unity_white }
			];
		}
	},
	{
		GoalName: "BingoAchievementChallenge",
		params: { passage: "Survivor" },
		BinDecode: [
			{ type: "number", offset: 0, size: 1, formatter: "passage" }	//	0: Passage choice
		],
		BinEncode: function(p) {
			var b = Array(4); b.fill(0);
			b[0] = challengeValue("BingoAchievementChallenge");
			b[3] = enumToValue(p.passage, "passage");
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		},
		TextEncode: function(p) {
			return "System.String|{0}|Passage|0|passage><0><0".replace("{0}", p.passage);
		},
		TextDecode: [
			{ param: "passage", type: "SettingBox", datatype: "System.String", name: "Passage", position: "0", list: "passage" },	//	0: Passage choice
			{ param: "completed", type: "number" },
			{ param: "revealed",  type: "number" }
		],
		GoalComments: function(p) {
			return "";
		},
		GoalDesc: function(p) {
			return "Earn " + (passageToDisplayNameMap[p.passage] || "unknown") + " passage.";
		},
		GoalPaint: function(p) {
			return [
				{ type: "icon", value: "smallEmptyCircle", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: p.passage + "A",    scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "smallEmptyCircle", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 }
			];
		}
	},
	{
		GoalName: "BingoAllRegionsExcept",
		BinDecode: [
			{ type: "number", offset: 0, size: 1, formatter: "regionsreal" },	//	0: Excluded region choice
			{ type: "number", offset: 1, size: 1, formatter: ""            },	//	1: Remaining region count
			{ type: "string", offset: 2, size: 0, formatter: "regionsreal", joiner: "|" } 	//	2: Remaining regions list
		],
		TextEncode: function(p) {
			return "System.String|{0}|Region|0|regionsreal><{2}><0><System.Int32|{1}|Amount|1|NULL><0><0";
		},
	},
	{
		GoalName: "BingoBombTollChallenge",
		BinDecode: [
			{ type: "number", offset: 0, size: 1, formatter: "tolls"   },	//	0: Toll choice
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean" } 	//	1: Pass Toll flag
		],
		TextEncode: function(p) {
			return "System.String|{0}|Scavenger Toll|1|tolls><System.Boolean|{1}|Pass the Toll|0|NULL><0><0";
		},
	},
	{
		GoalName: "BingoCollectPearlChallenge",
		BinDecode: [
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean" },	//	0: Specific Pearl flag
			{ type: "number", offset: 0, size: 1, formatter: "pearls"  },	//	1: Pearl choice
			{ type: "number", offset: 1, size: 2, formatter: ""        } 	//	2: Item amount
		],
		TextEncode: function(p) {
			return "System.Boolean|{0}|Specific Pearl|0|NULL><System.String|{1}|Pearl|1|pearls><0><System.Int32|{2}|Amount|3|NULL><0><0><";
		},
	},
	{
		GoalName: "BingoCraftChallenge",
		BinDecode: [
			{ type: "number", offset: 0, size: 1, formatter: "craft"  },	//	0: Item choice
			{ type: "number", offset: 1, size: 2, formatter: ""       } 	//	1: Item amount
		],
		TextEncode: function(p) {
			return "System.String|{0}|Item to Craft|0|craft><System.Int32|{1}|Amount|1|NULL><0><0><0";
		},
	},
	{
		GoalName: "BingoCreatureGateChallenge",
		BinDecode: [
			{ type: "number", offset: 0, size: 1, formatter: "transport"  },	//	0: Creature choice
			{ type: "number", offset: 1, size: 1, formatter: ""           } 	//	1: Gate amount
		],
		TextEncode: function(p) {
			return "System.String|{0}|Creature Type|1|transport><0><System.Int32|{1}|Amount|0|NULL><empty><0><0";
		},
	},
	{
		GoalName: "BingoCycleScoreChallenge",
		BinDecode: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Score amount
		],
		TextEncode: function(p) {
			return "System.Int32|{0}|Target Score|0|NULL><0><0";
		},
	},
	{	//	< v1.091
		GoalName: "BingoDamageChallenge",
		params:     { weapon: "Any Weapon", victim: "Any Creature", current: 0,     amount: 0,     inOneCycle: false,  region: "Any Region", subregion: "Any Subregion", completed: 0,     revealed: 0     },
		paramTypes: { weapon: "weapon",     victim: "creature",     current: "int", amount: "int", inOneCycle: "bool", region: "regions",    subregion: "subregions",    completed: "int", revealed: "int" },
		BinDecode: [
			{ type: "number", offset: 0,  size: 1, formatter: "weapons"   },	//	0: Weapon choice
			{ type: "number", offset: 1,  size: 1, formatter: "creatures" },	//	1: Creature choice
			{ type: "number", offset: 2,  size: 2, formatter: ""          },	//	2: Hits amount
		],
		TextEncode: function(p) {
			return "System.String|{0}|Weapon|0|weapons><System.String|{1}|Creature Type|1|creatures><0><System.Int32|{2}|Amount|2|NULL><0><0".replace("{0}", p.weapon).replace("{1}", p.victim).replace("{2}", p.amount);
		},
		BinDecode: [
			{ param: "weapon", type: "number", offset: 0, size: 1, formatter: "weapons"   },	//	0: Item choice
			{ param: "victim", type: "number", offset: 1, size: 1, formatter: "creatures" },	//	1: Creature choice
			{ param: "amount", type: "number", offset: 2, size: 2, formatter: ""          } 	//	2: Hits amount
		],
		TextDecode: [
			{ param: "weapon",    type: "SettingBox", datatype: "System.String",  name: "Weapon",        position: "0", list: "weapons"   },	//	0: Item choice
			{ param: "victim",    type: "SettingBox", datatype: "System.String",  name: "Creature Type", position: "1", list: "creatures" },	//	1: Creature choice
			{ param: "current",   type: "number" },
			{ param: "amount",    type: "SettingBox", datatype: "System.Int32",   name: "Amount",        position: "2", list: "NULL"      }, 	//	2: Score amount
			{ param: "completed", type: "number" },
			{ param: "revealed",  type: "number" }
		],
		BinEncode: function(p) {
			if (p.inOneCycle || p.region !== "Any Region" || p.subregion !== "Any Subregion") return undefined;
			var b = Array(7); b.fill(0);
			b[0] = challengeValue("BingoDamageChallenge");
			b[3] = enumToValue(p.weapon, "weapons");
			b[4] = enumToValue(p.victim, "creatures");
			applyShort(b, 5, p.amount);
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		},
		GoalCategory: "Hitting creatures with items",
		GoalComments: function(p) { return "Note: subregion was never fully implemented, and is deprecated in v1.2+. Bingovista displays this parameter only for completeness."; },
		GoalDesc: function(p) {
			var r = "";
			if (p.region !== "Any Region") {
				r = (regionCodeToDisplayName[p.region] || "") + " / " + (regionCodeToDisplayNameSaint[p.region] || "");
				r = r.replace(/^\s\/\s|\s\/\s$/g, "");
				if (r === "")
					throw new TypeError(p.GoalName + ": error, region selection \"" + p.region + "\" not found in regionCodeToDisplayName[]");
				r = ", in " + r;
			}
			if (p.subregion !== "Any Subregion") {
				if (p.subregion === "Journey\\'s End") p.subregion = "Journey\'s End";
				r = ", in " + p.subregion;
				if (BingoEnum_AllSubregions.indexOf(p.subregion) == -1)
					throw new TypeError(p.GoalName + ": error, subregion selection \"" + p.subregion + "\" not found in BingoEnum_AllSubregions[]");
			}
			var d = "Hit ";
			d += (creatureNameToDisplayTextMap[p.victim] || p.victim) + " with ";
			d += itemNameToDisplayTextMap[p.weapon] || p.weapon;
			d += " " + String(p.amount) + ((p.amount > 1) ? " times" : " time");
			if (r > "") d += r;
			if (p.inOneCycle) d += ", in one cycle";
			d += ".";
			return d;
		},
		GoalPaint: function(p) {
//		params: { weapon: "Any Weapon", victim: "Any Creature", current: 0, amount: 0, inOneCycle: false, region: "Any Region", subregion: "Any Subregion", completed: 0, revealed: 0 },
			var r = [];
			if (p.weapon !== "Any Weapon") {
				if (itemNameToDisplayTextMap[p.weapon] === undefined)
					throw new TypeError(thisname + ": error, item type \"" + p.weapon + "\" not found in itemNameToDisplayTextMap[]");
				r.push( { type: "icon", value: itemNameToIconAtlasMap[p.weapon], scale: 1, color: entityToColor(p.weapon), rotation: 0 } );
			}
			r.push( { type: "icon", value: "bingoimpact", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
			if (p.victim !== "Any Creature") {
				if (creatureNameToDisplayTextMap[p.victim] === undefined)
					throw new TypeError(thisname + ": error, creature type \"" + p.victim + "\" not found in creatureNameToDisplayTextMap[]");
				r.push( { type: "icon", value: creatureNameToIconAtlasMap[p.victim], scale: 1, color: entityToColor(p.victim), rotation: 0 } );
			}
			if (p.subregion === "Any Subregion") {
				if (p.region !== "Any Region") {
					r.push( { type: "break" } );
					r.push( { type: "text", value: p.region, color: RainWorldColors.Unity_white } );
				}
			} else {
				r.push( { type: "break" } );
				r.push( { type: "text", value: p.subregion, color: RainWorldColors.Unity_white } );
			}
			r.push( { type: "break" } );
			r.push( { type: "text", value: "[0/" + String(p.amount) + "]", color: RainWorldColors.Unity_white } );
			if (p.inOneCycle === "true")
				r.push( { type: "icon", value: "cycle_limit", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
			return r;
		}
	},
	{
		GoalName: "BingoDepthsChallenge",
		BinDecode: [
			{ type: "number", offset: 0, size: 1, formatter: "depths" }	//	0: Creature choice
		],
		TextEncode: function(p) {
			return "System.String|{0}|Creature Type|0|depths><0><0";
		},
	},
	{
		GoalName: "BingoDodgeLeviathanChallenge",
		BinDecode: [ ],
		TextEncode: function(p) {
			return "0><0";
		},
	},
	{
		GoalName: "BingoDontUseItemChallenge",
		BinDecode: [
			{ type: "number", offset: 0, size: 1, formatter: "banitem" },	//	0: Item choice
			{ type: "bool",   offset: 0,  bit: 4, formatter: ""        },	//	1: Pass Toll flag
			{ type: "bool",   offset: 0,  bit: 5, formatter: ""        } 	//	2: isCreature flag
		],
		TextEncode: function(p) {
			return "System.String|{0}|Item type|0|banitem><{1}><0><0><{2}";
		},
	},
	{
		GoalName: "BingoEatChallenge",
		BinDecode: [
			{ type: "number", offset: 0, size: 2, formatter: ""     },	//	0: Item amount
			{ type: "bool",   offset: 0,  bit: 4, formatter: ""     },	//	1: Creature flag
			{ type: "number", offset: 2, size: 1, formatter: "food" } 	//	2: Item choice
		],
		TextEncode: function(p) {
			return "System.Int32|{0}|Amount|1|NULL><0><{1}><System.String|{2}|Food type|0|food><0><0";
		},
	},
	{
		GoalName: "BingoEchoChallenge",
		BinDecode: [
			{ type: "number", offset: 0, size: 1, formatter: "echoes"  },	//	0: Echo choice
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean" } 	//	1: Starving flag
		],
		TextEncode: function(p) {
			return "System.String|{0}|Region|0|echoes><System.Boolean|{1}|While Starving|1|NULL><0><0";
		},
	},
	{
		GoalName: "BingoEnterRegionChallenge",
		BinDecode: [
			{ type: "number", offset: 0, size: 1, formatter: "regionsreal" }	//	0: Region choice
		],
		TextEncode: function(p) {
			return "System.String|{0}|Region|0|regionsreal><0><0";
		},
	},
	{
		GoalName: "BingoGlobalScoreChallenge",
		BinDecode: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Score amount
		],
		TextEncode: function(p) {
			return "0><System.Int32|{0}|Target Score|0|NULL><0><0";
		},
	},
	{
		GoalName: "BingoGreenNeuronChallenge",
		BinDecode: [
			{ type: "bool", offset: 0, bit: 4, formatter: "boolean" }	//	0: Moon flag
		],
		TextEncode: function(p) {
			return "System.Boolean|{0}|Looks to the Moon|0|NULL><0><0";
		},
	},
	{
		GoalName: "BingoHatchNoodleChallenge",
		BinDecode: [
			{ type: "number", offset: 0, size: 1, formatter: ""        },	//	0: Hatch amount
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean" }  	//	1: At Once flag
		],
		TextEncode: function(p) {
			return "0><System.Int32|{0}|Amount|1|NULL><System.Boolean|{1}|At Once|0|NULL><0><0";
		},
	},
	{
		GoalName: "BingoHellChallenge",
		BinDecode: [
			{ type: "number", offset: 0, size: 1, formatter: "" }	//	0: Squares amount
		],
		TextEncode: function(p) {
			return "0><System.Int32|{0}|Amount|0|NULL><0><0";
		},
	},
	{
		GoalName: "BingoItemHoardChallenge",
		BinDecode: [
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean"    },	//	0: Any shelter flag (added v1.092)
			{ type: "number", offset: 0, size: 1, formatter: ""           },	//	1: Item amount
			{ type: "number", offset: 1, size: 1, formatter: "expobject"  } 	//	2: Item choice
		],
		TextEncode: function(p) {
			return "System.Boolean|{0}|Any Shelter|2|NULL><0><System.Int32|{1}|Amount|0|NULL><System.String|{2}|Item|1|expobject><0><0><";
		},
	},
	{
		GoalName: "BingoKarmaFlowerChallenge",
		BinDecode: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Item amount
		],
		TextEncode: function(p) {
			return "0><System.Int32|{0}|Amount|0|NULL><0><0";
		},
	},
	{
		GoalName: "BingoKillChallenge",
		BinDecode: [
			{ type: "number", offset: 0, size: 1, formatter: "creatures"      },	//	0: Creature choice
			{ type: "number", offset: 1, size: 1, formatter: "weaponsnojelly" },	//	1: Item choice
			{ type: "number", offset: 2, size: 2, formatter: ""               },	//	2: Kill amount
			{ type: "number", offset: 4, size: 1, formatter: "regions"        },	//	3: Region choice
			{ type: "number", offset: 5, size: 1, formatter: "subregions"     },	//	4: Subregion choice
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean"        },	//	5: One Cycle flag
			{ type: "bool",   offset: 0,  bit: 5, formatter: "boolean"        },	//	6: Death Pit flag
			{ type: "bool",   offset: 0,  bit: 6, formatter: "boolean"        } 	//	7: Starving flag
		],
		TextEncode: function(p) {
			return "System.String|{0}|Creature Type|0|creatures><System.String|{1}|Weapon Used|6|weaponsnojelly><System.Int32|{2}|Amount|1|NULL><0><System.String|{3}|Region|5|regions><System.String|{4}|Subregion|4|subregions><System.Boolean|{5}|In one Cycle|3|NULL><System.Boolean|{6}|Via a Death Pit|7|NULL><System.Boolean|{7}|While Starving|2|NULL><0><0";
		},
	},
	{
		GoalName: "BingoMaulTypesChallenge",
		BinDecode: [
			{ type: "number", offset: 0, size: 1, formatter: "" }	//	0: Item amount
		],
		TextEncode: function(p) {
			return "0><System.Int32|{0}|Amount|0|NULL><0><0><";
		},
	},
	{
		GoalName: "BingoMaulXChallenge",
		BinDecode: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Item amount
		],
		TextEncode: function(p) {
			return "0><System.Int32|{0}|Amount|0|NULL><0><0";
		},
	},
	{
		GoalName: "BingoNeuronDeliveryChallenge",
		BinDecode: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Item amount
		],
		TextEncode: function(p) {
			return "System.Int32|{0}|Amount of Neurons|0|NULL><0><0><0";
		},
	},
	{
		GoalName: "BingoNoNeedleTradingChallenge",
		BinDecode: [ ],
		TextEncode: function(p) {
			return "0><0";
		},
	},
	{
		GoalName: "BingoNoRegionChallenge",
		BinDecode: [
			{ type: "number", offset: 0, size: 1, formatter: "regionsreal" }	//	0: Region choice
		],
		TextEncode: function(p) {
			return "System.String|{0}|Region|0|regionsreal><0><0";
		},
	},
	{
		GoalName: "BingoPearlDeliveryChallenge",
		BinDecode: [
			{ type: "number", offset: 0, size: 1, formatter: "regions" }	//	0: Region choice
		],
		TextEncode: function(p) {
			return "System.String|{0}|Pearl from Region|0|regions><0><0";
		},
	},
	{
		GoalName: "BingoPearlHoardChallenge",
		BinDecode: [
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean" },	//	0: Common Pearls flag
			{ type: "number", offset: 0, size: 2, formatter: ""        },	//	1: Item amount
			{ type: "number", offset: 2, size: 1, formatter: "regions" } 	//	2: Region choice
		],
		TextEncode: function(p) {
			return "System.Boolean|{0}|Common Pearls|0|NULL><System.Int32|{1}|Amount|1|NULL><System.String|{2}|In Region|2|regions><0><0";
		},
	},
	{
		GoalName: "BingoPinChallenge",
		BinDecode: [
			{ type: "number", offset: 0, size: 2, formatter: ""           },	//	0: Pin amount
			{ type: "number", offset: 2, size: 1, formatter: "creatures"  },	//	1: Creature choice
			{ type: "number", offset: 3, size: 1, formatter: "regions"    } 	//	2: Region choice
		],
		TextEncode: function(p) {
			return "0><System.Int32|{0}|Amount|0|NULL><System.String|{1}|Creature Type|1|creatures><><System.String|{2}|Region|2|regions><0><0";
		},
	},
	{
		GoalName: "BingoPopcornChallenge",
		params: { amount: 1, current: 0, completed: 0, revealed: 0 },
		BinDecode: [
			{ param: "amount", type: "number", offset: 0, size: 2, formatter: "" },	//	0: Item amount
		],
		TextDecode: [
			{ param: "current", type: "number" },
			{ param: "amount", type: "SettingBox", datatype: "System.Int32", name: "Amount", position: "0", list: "NULL" },
			{ param: "completed", type: "number" },
			{ param: "revealed",  type: "number" }
		],
		TextEncode: function(p) {
			return "0><System.Int32|" + String(p.amount) + "|Amount|0|NULL><0><0";
		},
	},
	{
		GoalName: "BingoRivCellChallenge",
		params: { completed: 0, revealed: 0 },
		BinDecode: [ ],
		TextEncode: function(p) {
			return "0><0";
		},
	},
	{
		GoalName: "BingoSaintDeliveryChallenge",
		params: { completed: 0, revealed: 0 },
		BinDecode: [ ],
		TextDecode: [
			{ param: "completed", type: "number" },
			{ param: "revealed",  type: "number" }
		],
		TextEncode: function(p) {
			return "0><0";
		},
	},
	{
		GoalName: "BingoSaintPopcornChallenge",
		params: { amount: 1, current: 0, completed: 0, revealed: 0 },
		BinDecode: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Item amount
		],
		TextEncode: function(p) {
			return "0><System.Int32|" + String(p.amount) + "|Amount|0|NULL><0><0";
		},
	},
	{
		GoalName: "BingoStealChallenge",
		params: { item: BingoEnum_theft[0], toll: false, amount: 1 },
		BinDecode: [
			{ param: "item",   type: "number", offset: 0, size: 1, formatter: "theft"   },	//	0: Item choice
			{ param: "toll",   type: "bool",   offset: 0,  bit: 4, formatter: "boolean" },	//	1: From Toll flag
			{ param: "amount", type: "number", offset: 1, size: 2, formatter: ""        } 	//	2: Steal amount
		],
		TextDecode: [
			{ param: "amount", type: "SettingBox", datatype: "System.String", name: "Item", position: "0", list: "" },
			{ param: "completed", type: "number" },
			{ param: "revealed",  type: "number" }
		],
		TextEncode: function(p) {
			return "System.String|" + p.item +
					"|Item|1|theft><System.Boolean|" + BingoEnum_Boolean[p.toll * 1] +
					"|From Scavenger Toll|0|NULL><0><System.Int32|" + String(p.amount) +
					"|Amount|2|NULL><0><0";
		},
	},
	{
		GoalName: "BingoTameChallenge",
		params:     { specific: true,   crit: BingoEnum_Befriendable[0], current: 0,     amount: 1,     completed: 0,     revealed: 0,     tamed: [""]     },
		paramTypes: { specific: "bool", crit: "friend",                  current: "int", amount: "int", completed: "int", revealed: "int", tamed: "string" },
		Upgrades: ["BingoTameExChallenge"],
		BinDecode: [
			{ param: "crit", type: "number", offset: 0, size: 1, formatter: "friend" }	//	0: Creature choice
		],
		BinEncode: function(p) {	
			if (!p.specific) return undefined;
			var b = Array(4); b.fill(0);
			b[0] = challengeValue(p.GoalName);
			applyBool(b, 1, 0, p.revealed == 0);
			b[3] = enumToValue(p.crit, "friend");
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		},
		TextDecode: [
			{ param: "crit", type: "SettingBox", datatype: "System.String", name: "Creature Type", position: "0", list: "friend" },
			{ param: "completed", type: "number" },
			{ param: "revealed",  type: "number" }
		],
		TextEncode: function(p) {
			if (!p.specific) return undefined;
			return "System.String|" + p.crit + "|Creature Type|0|friend><0><0";
		},
		GoalCategory: "Befriending creatures",
		GoalComments: function(p) {
			return "Taming occurs when a creature has been fed or rescued enough times to increase the player's reputation above some threshold, starting from a default depending on species, and the global and regional reputation of the player.<br>" +
			"Feeding occurs when: 1. the player drops an edible item, creature or corpse, 2. within view of the creature, and 3. the creature bites that object. A \"happy lizard\" sound indicates success. The creature does not need to den with the item to increase reputation. Stealing the object back from the creature's jaws does not reduce reputation.<br>" +
			"A rescue occurs when: 1. a creature sees or is grabbed by a threat, 2. the player attacks the threat (if the creatures was grabbed, the predator must be stunned enough to drop the creature), and 3. the creature sees the attack (or gets dropped because of it).<br>" +
			"For the multiple-tame option, creature <i>types</i> count toward progress (multiple tames of a given type/color/species do not increase the count). Note that any befriendable creature type counts towards the total, including both Lizards and Squidcadas.";
		},
		GoalDesc: function(p) {
			return (p.specific) ? ("Befriend " + entityNameQuantify(1, p.crit) + ".") : ("Befriend [0/" + p.amount + "] unique creatures.");
		},
		GoalPaint: function(p) {
			var r = [
				{ type: "icon", value: "FriendB", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 }
			];
			if (p.specific) {
				r.push( { type: "icon", value: creatureNameToIconAtlasMap[p.crit], scale: 1, color: entityToColor(p.crit), rotation: 0 } );
			} else {
				r.push( { type: "break" } );
				r.push( { type: "text", value: "[0/" + String(p.amount) + "]", color: RainWorldColors.Unity_white } );
			}
			return r;
		}
	},
	{
		GoalName: "BingoTradeChallenge",
		params: { amount: 1 },
		BinDecode: [
			{ param: "amount", type: "number", offset: 0, size: 2, formatter: "" }	//	0: Trade points amount
		],
		TextEncode: function(p) {
			return "0><System.Int32|" + String(p.amount) + "|Value|0|NULL><0><0";
		},
	},
	{
		GoalName: "BingoTradeTradedChallenge",
		params: { amount: 1 },
		BinDecode: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Trade item amount
		],
		TextEncode: function(p) {
			return "0><System.Int32|" + String(p.amount) + "|Amount of Items|0|NULL><empty><0><0";
		},
	},
	{
		GoalName: "BingoTransportChallenge",
		params: {},
		BinDecode: [
			{ type: "number", offset: 0, size: 1, formatter: "regions"    },	//	0: From Region choice
			{ type: "number", offset: 1, size: 1, formatter: "regions"    },	//	1: To Region choice
			{ type: "number", offset: 2, size: 1, formatter: "transport"  } 	//	2: Creature choice
		],
		TextEncode: function(p) {
			return "System.String|" +  +
					"|From Region|0|regions><System.String|" +  +
					"|To Region|1|regions><System.String|" +  +
					"|Creature Type|2|transport><><0><0";
		},
	},
	{
		GoalName: "BingoUnlockChallenge",
		params: { unlock: BingoEnum_AllUnlocks[0] },
		BinDecode: [
			{ type: "number", offset: 0, size: 2, formatter: "unlocks" }	//	0: Unlock token choice
		],
		TextEncode: function(p) {
			return "System.String|" + p.unlock + "|Unlock|0|unlocks><0><0";
		},
	},
	{
		GoalName: "BingoVistaChallenge",
		params: {},
		Upgrades: ["BingoVistaExChallenge"],
		BinDecode: [
			{ type: "number", offset: 0, size: 1, formatter: "regions" },	//	0: Region choice
			{ type: "string", offset: 5, size: 0, formatter: "", joiner: "" },	//	1: Room name (verbatim) (reads to zero terminator or end of goal)
			{ type: "number", offset: 1, size: 2, formatter: ""        },	//	2: Room X coordinate (decimal)
			{ type: "number", offset: 3, size: 2, formatter: ""        }	//	3: Room Y coordinate (decimal)
		],
		TextEncode: function(p) {
			return p.region + "><System.String|" + p.room + "|Room|0|vista><"
					+ String(p.x) + "><" + String(p.y) + "><0><0";
		},
	},
	{	/*  Alternate enum version for as-generated locations  */
		GoalName: "BingoVistaExChallenge",
		RootGoal: "BingoVistaChallenge",
		BinDecode: [
			{ type: "number", offset: 0, size: 1, formatter: "vista_region" },	//	0: Vista Point choice
			{ type: "number", offset: 0, size: 1, formatter: "vista_room"   },
			{ type: "number", offset: 0, size: 1, formatter: "vista_x"      },
			{ type: "number", offset: 0, size: 1, formatter: "vista_y"      }
		],
		TextEncode: function(p) {
			return p.region + "><System.String|" + p.room + "|Room|0|vista><"
					+ String(p.x) + "><" + String(p.y) + "><0><0";
		},
	},
	{
		GoalName: "BingoEnterRegionFromChallenge",
		BinDecode: [
			{ type: "number", offset: 0, size: 1, formatter: "regionsreal" },	//	0: From regions choice
			{ type: "number", offset: 1, size: 1, formatter: "regionsreal" }	//	1: To regions choice
		],
		TextEncode: function(p) {
			return "System.String|" + p.from +
					"|From|0|regionsreal><System.String|" + p.to +
					"|To|0|regionsreal><0><0";
		},
	},
	{
		GoalName: "BingoMoonCloakChallenge",
		BinDecode: [
			{ type: "bool", offset: 0, bit: 4, formatter: "boolean" }	//	0: Delivery choice
		],
		TextEncode: function(p) {
			return "System.Boolean|" + BingoEnum_Boolean[p.specific * 1] + "|Deliver|0|NULL><0><0";
		},
	},
	{
		GoalName: "BingoBroadcastChallenge",
		BinDecode: [
			{ type: "number", offset: 0, size: 1, formatter: "chatlogs" }	//	0: Chatlog selection
		],
		TextEncode: function(p) {
			return "System.String|" + p.broadcast + "|Broadcast|0|chatlogs><0><0";
		},
	},
	{	//	upgrade; added v1.092
		GoalName: "BingoDamageExChallenge",
		RootGoal: "BingoDamageChallenge",
		//	see BingoDamageChallenge for defaults, upgradeChallenges() for what's copied
		BinDecode: [
			{ param: "weapon",     type: "number", offset: 0, size: 1, formatter: "weapons"    },	//	0: Weapon choice
			{ param: "victim",     type: "number", offset: 1, size: 1, formatter: "creatures"  },	//	1: Creature choice
			{ param: "amount",     type: "number", offset: 2, size: 2, formatter: ""           },	//	2: Hits amount
			{ param: "inOneCycle", type: "bool",   offset: 0,  bit: 4, formatter: "boolean"    },	//	3: One Cycle flag
			{ param: "region",     type: "number", offset: 4, size: 1, formatter: "regions"    },	//	4: Region choice
			{ param: "subregion",  type: "number", offset: 5, size: 1, formatter: "subregions" },	//	5: Subregion choice
		],
		BinEncode: function(p) {
			var b = Array(9); b.fill(0);
			b[0] = challengeValue("BingoDamageExChallenge");
			b[3] = enumToValue(p.weapon, "weapons");
			b[4] = enumToValue(p.victim, "creatures");
			applyShort(b, 5, p.amount);
			applyBool(b, 1, 4, p.inOneCycle);
			b[7] = enumToValue(p.region, "regions");
			b[8] = enumToValue(p.subregion, "subregions");
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		},
		TextDecode: [
			{ param: "weapon",     type: "SettingBox", datatype: "System.String",  name: "Weapon",        position: "0", list: "weapons"    },
			{ param: "victim",     type: "SettingBox", datatype: "System.String",  name: "Creature Type", position: "1", list: "creatures"  },
			{ param: "current",    type: "number" },
			{ param: "amount",     type: "SettingBox", datatype: "System.Int32",   name: "Amount",        position: "2", list: "NULL", maxval: INT_MAX },
			{ param: "inOneCycle", type: "SettingBox", datatype: "System.Boolean", name: "In One Cycle",  position: "3", list: "NULL"       },
			{ param: "region",     type: "SettingBox", datatype: "System.String",  name: "Region",        position: "4", list: "regions"    },
			{ param: "subregion",  type: "SettingBox", datatype: "System.String",  name: "Subregion",     position: "5", list: "subregions" },
			{ param: "completed",  type: "number" },
			{ param: "revealed",   type: "number" }
		],
		TextEncode: function(p) {
			if (!p.specific) return undefined;
			return "System.String|" + p.weapon +
					"|Weapon|0|weapons><System.String|" + p.victim +
					"|Creature Type|1|creatures><0><System.Int32|" + String(p.amount) +
					"|Amount|2|NULL><System.Boolean|" + BingoEnum_Boolean[p.inOneCycle * 1] +
					"|In One Cycle|3|NULL><System.String|" + p.region +
					"|Region|4|regions><System.String|" + p.subregion +
					"|Subregion|5|subregions><0><0";
		},

	},
	{	//	upgrade; added v1.092
		GoalName: "BingoTameExChallenge",
		RootGoal: "BingoTameChallenge",
		BinDecode: [
			{ param: "specific", type: "bool",   offset: 0,  bit: 4, formatter: "boolean" },	//	0: Specific flag
			{ param: "crit",     type: "number", offset: 0, size: 1, formatter: "friend"  },	//	1: Creature choice
			{ param: "amount",   type: "number", offset: 1, size: 1, formatter: ""        } 	//	2: Tame amount
		],
		BinEncode: function(p) {	
			if (p.specific) return undefined;
			var b = Array(5); b.fill(0);
			b[0] = challengeValue("BingoTameExChallenge");
			applyBool(b, 1, 0, p.revealed == 0);
			b[3] = enumToValue(p.crit, "friend");
			applyBool(b, 1, 4, p.specific);
			b[4] = p.amount;
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		},
		TextDecode: [
			{ param: "specific",  type: "SettingBox", datatype: "System.Boolean", name: "Specific Creature Type", position: "0", list: "NULL"   },
			{ param: "crit",      type: "SettingBox", datatype: "System.String",  name: "Creature Type",          position: "1", list: "friend" },
			{ param: "current",   type: "number" },
			{ param: "amount",    type: "SettingBox", datatype: "System.Int32",   name: "Amount", position: "2", list: "NULL", maxval: CHAR_MAX },
			{ param: "completed", type: "number" },
			{ param: "revealed",  type: "number" },
			{ param: "tamed",     type: "list"   }
		],
		TextEncode: function(p) {
			return "System.Boolean|" + BingoEnum_Boolean[p.specific * 1] +
					"|Specific Creature Type|0|NULL><System.String|" + p.crit +
					"|Creature Type|1|friend><0><System.Int32|" + String(p.amount) +
					"|Amount|2|NULL><0><0><";
		}
	},
	{	//	upgrade; added v1.2 (remove subregion)
		GoalName: "BingoDamageEx2Challenge",
		RootGoal: "BingoDamageChallenge",
		BinDecode: [
			{ param: "weapon",     type: "number", offset: 0, size: 1, formatter: "weapons"    },	//	0: Weapon choice
			{ param: "victim",     type: "number", offset: 1, size: 1, formatter: "creatures"  },	//	1: Creature choice
			{ param: "amount",     type: "number", offset: 2, size: 2, formatter: ""           },	//	2: Hits amount
			{ param: "inOneCycle", type: "bool",   offset: 0,  bit: 4, formatter: "boolean"    },	//	3: One Cycle flag
			{ param: "region",     type: "number", offset: 4, size: 1, formatter: "regions"    } 	//	4: Region choice
		],
		BinEncode: function(p) {
			if (p.subregions !== "Any Subregion") return undefined;
			var b = Array(8); b.fill(0);
			b[0] = challengeValue("BingoDamageEx2Challenge");
			b[3] = enumToValue(p.weapon, "weapons");
			b[4] = enumToValue(p.victim, "creatures");
			applyShort(b, 5, p.amount);
			applyBool(b, 1, 4, p.inOneCycle);
			b[7] = enumToValue(p.regions, "regions");
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		},
		TextDecode: [
			{ param: "weapon",     type: "SettingBox", datatype: "System.String",  name: "Weapon",        position: "0", list: "weapons"   },
			{ param: "victim",     type: "SettingBox", datatype: "System.String",  name: "Creature Type", position: "1", list: "creatures" },
			{ param: "current",    type: "number" },
			{ param: "amount",     type: "SettingBox", datatype: "System.Int32",   name: "Amount",        position: "2", list: "NULL", maxval: CHAR_MAX },
			{ param: "inOneCycle", type: "SettingBox", datatype: "System.Boolean", name: "In One Cycle",  position: "3", list: "NULL"      },
			{ param: "region",     type: "SettingBox", datatype: "System.String",  name: "Region",        position: "4", list: "regions"   },
			{ param: "completed",  type: "number" },
			{ param: "revealed",   type: "number" }
		],
		TextEncode: function(p) {
			if (!p.specific) return undefined;
			return "System.String|" + p.weapon +
					"|Weapon|0|weapons><System.String|" + p.victim +
					"|Creature Type|1|creatures><0><System.Int32|" + String(p.amount) +
					"|Amount|2|NULL><System.Boolean|" + BingoEnum_Boolean[p.inOneCycle * 1] +
					"|In One Cycle|3|NULL><System.String|" + p.region +
					"|Region|4|regions><0><0";
		},
	},
];

/**
 *	Used by binGoalToText() and upgradeChallenges().
 *	List of upgraded challenges.
 *	CHALLENGE_DEFINITIONS[] elements are ordered for historical
 *	reasons; this ordering is indexed explicitly by the binary format.
 *	To accommodate upgraded and legacy challenges, the old challenges
 *	remain in place, and CHALLENGE_DEFINITIONS is appended from
 *	time to time with upgrades ("-Ex-" versions).
 *
 *	key: original internal name; superclass
 *	value: list of new internal names; subclasses
 *	[not present]: no change
 */
ChallengeUpgrades = {
	"BingoVistaChallenge":  [ "BingoVistaExChallenge"  ],
	//	v1.092
	"BingoDamageChallenge": [ "BingoDamageExChallenge", "BingoDamageEx2Challenge" ],
	"BingoTameChallenge":   [ "BingoTameExChallenge"   ],
};


/* * * Utility Functions * * */

/**
 *	Appends preset goals to BingoEnum_VistaPoints_Code[].
 *	Used on startup with BingoEnum_VistaPoints[].
 *	Potential future mod use.
 */
function addVistaPointsToCode(vistas) {
	for (var v of vistas) {
		BingoEnum_VistaPoints_region.push(v.region);
		BingoEnum_VistaPoints_room.push(v.room);
		BingoEnum_VistaPoints_x.push(v.x);
		BingoEnum_VistaPoints_y.push(v.y);
	}
}

/**
 *	Called on startup.  Appends goals to BingoEnum_CHALLENGES[].
 */
function appendCHALLENGES() {
	var exceptions = Object.values(ChallengeUpgrades).flat();
	for (var g of CHALLENGE_DEFINITIONS) {
		if (exceptions.indexOf(g) < 0)
			BingoEnum_CHALLENGES.push(g.GoalName);
	}
}

/**
 *	Sets CHALLENGE_DEFINITIONS Upgrades arrays, according
 *	to ChallengeUpgrades lists.
 *	Sets params, GoalCategory, GoalComments, GoalDesc and GoalPaint
 *	properties on all upgrade challenges, to the base challenge's
 *	values.
 */
function upgradeChallenges() {
	var exceptions = Object.values(ChallengeUpgrades).flat();
	for (var i = 0; i < CHALLENGE_DEFINITIONS.length; i++) {
		CHALLENGE_DEFINITIONS[i].Upgrades = [];
		//	exclude upgrade challenges; expand root challenge only
		if (exceptions.indexOf(CHALLENGE_DEFINITIONS[i].GoalName) < 0) {
			//	every non-upgrade challenge is its own root challenge...
			CHALLENGE_DEFINITIONS[i].Upgrades.push(i);
			if (ChallengeUpgrades[CHALLENGE_DEFINITIONS[i].GoalName] !== undefined) {
				//	root challenge has upgrades; list them:
				ChallengeUpgrades[CHALLENGE_DEFINITIONS[i].GoalName].forEach( s => {
					var idx = challengeValue(s);
					CHALLENGE_DEFINITIONS[i].Upgrades.push(idx);
					//	also copy common objects/methods
					CHALLENGE_DEFINITIONS[idx].params       = CHALLENGE_DEFINITIONS[i].params;
					CHALLENGE_DEFINITIONS[idx].GoalCategory = CHALLENGE_DEFINITIONS[i].GoalCategory;
					CHALLENGE_DEFINITIONS[idx].GoalComments = CHALLENGE_DEFINITIONS[i].GoalComments;
					CHALLENGE_DEFINITIONS[idx].GoalDesc     = CHALLENGE_DEFINITIONS[i].GoalDesc;
					CHALLENGE_DEFINITIONS[idx].GoalPaint    = CHALLENGE_DEFINITIONS[i].GoalPaint;
				} );
			}
		}
	}
}

/**
 *	Convert a text goal into internal/abstract/JS data structure representation.
 *	Text structure, types, and values/ranges are validated.
 */
function textGoalToAbstract(s) {
	s = String(s);
	var g = s.split("~");
	if (g.length < 2) return { error: "not a goal, or goal has no parameters" };
	if (g.length > 2) return { error: "not a goal, or has too many sections" };
	var def = CHALLENGE_DEFINITIONS[challengeValue(g[0])];
	if (def === undefined)
		return { error: "unknown goal: " + g[0] };
	var indices = def.Upgrades;
	var r;
	for (var i = 0; i < indices.length; i++) {
		r = tryGoal(g[1].split("><"), CHALLENGE_DEFINITIONS[indices[i]]);
		if (r !== undefined) break;
	}
	if (r === undefined) return { error: g[0] + ": no matching decoder" };
	var err = "";
	for (var p of r.paramList) {
		if (r[p].error.length > 0) err += r[p].error + "; ";
		r[p] = r[p].value;
	}
	r.error = (err.length > 0) ? (g[0] + ": " + err.substring(0, err.length - 2)) : "";
	r.GoalName = g[0];

	return r;

	function tryGoal(b, template) {
		var decoder = template.TextDecode;
		if (b.length != decoder.length)
			return undefined;
		var rr = { paramList: [], valueList: [] };
		for (var n of Object.keys(template.params)) {
			rr[n] = { value: template.params[n], error: "" };
			rr.paramList.push(n);
		}
		for (var i = 0; i < decoder.length; i++) {
			var p = decoder[i].param;
			if (decoder[i].type === "SettingBox") {
				rr[p] = checkSettings(b[i], decoder[i]);
			} else if (decoder[i].type === "number") {
				rr[p] = { value: parseInt(b[i]), error: "" };
				if (isNaN(rr[p].value)) {
					rr[p].value = decoder[i].defaultval;
					rr[p].error = "not a number";
				} else if (rr[p].value > decoder[i].maxval) {
					rr[p].value = decoder[i].maxval;
					rr[p].error = "number out of range; setting to maximum";
				} else if (rr[p].value < 0) {
					rr[p].value = 0;
					rr[p].error = "number negative; setting to zero";
				}
			} else if (decoder[i].type === "list") {
				rr[p] = { value: b[i].split("|"), error: "" };
			} else {
				rr[p] = { value: decoder[i].defaultval, error: "undefined type " + String(decoder[i].type) };
			}
			if (rr[p].error.length > 0) rr[p].error = "parameter " + i + " \"" + p + "\", " + rr[p].error;
		}
		for (var i = 0; i < rr.paramList.length; i++)
			rr.valueList.push((rr[rr.paramList[i]].value instanceof Array) ?
					rr[rr.paramList[i]].value.join("|") : String(rr[rr.paramList[i]].value));
		rr.GoalCategory = template.GoalCategory;
		rr.GoalComments = template.GoalComments;
		rr.GoalDesc = template.GoalDesc;
		rr.GoalPaint = template.GoalPaint;
		rr.BinEncode = template.BinEncode;

		return rr;
	}

	function checkSettings(s, template) {
		var ar = s.split("|");
		//	number of parameters
		if (ar.length < 5) return { value: template.defaultval, error: "SettingBox parameters missing" };
		if (ar.length > 5) return { value: template.defaultval, error: "SettingBox parameters excess" };
		//	data type
		if (ar[0] !== template.datatype)
			return { value: template.defaultval, error: "SettingBox type mismatch" };
		var rr = { value: template.defaultval, error: "" };
		var errList = [];
		//	menu parameters
		if (ar[2] !== template.name)
			errList.push("name mismatch");
		if (ar[3] !== template.position)
			errList.push("position mismatch");
		//	type, and parse the value of that type
		if (ar[0] === "System.Boolean") {
			if (ar[1] === "true")
				rr.value = true;
			else if (ar[1] === "false")
				rr.value = false;
			else {
				rr.value = template.defaultval;
				errList.push("invalid Boolean value");
			}
		} else if (ar[0] === "System.Int32") {
			rr.value = parseInt(ar[1]);
			if (isNaN(rr.value)) {
				rr.value = template.defaultval;
				errList.push("Int32 value " + ar[1] + " not a number");
			} else if (rr.value > INT_MAX) {
				rr.value = INT_MAX;
				errList.push("Int32 number out of range");
			} else if (rr.value < 0) {
				rr.value = 0;
				errList.push("Int32 number negative");
			}
		} else if (ar[0] === "System.String") {
			rr.value = ar[1];
			//	validate which kind of string it is
			if (ALL_ENUMS[ar[4]] !== undefined && ALL_ENUMS[ar[4]].indexOf(ar[1]) < 0)
				errList.push("value not found in list");
			if (ar[4] !== template.list)
				errList.push("list mismatch \"" + ar[4] + "\"");
		} else {
			errList.push("unknown type \"" + ar[0] + "\"");
		}
		if (ar[0] !== "System.String" && ar[4] !== "NULL")
			errList.push("list mismatch \"" + ar[4] + "\"");
		//	form error string, if any
		if (errList.length)
			rr.error = "SettingBox " + errList.join(", ");
		return rr;
	}

}

/**
 *	Reads the given array as a binary challenge:
 *	struct bingo_goal_s {
 *		uint8_t type;   	//	BINGO_GOALS index
 *		uint8_t flags;  	//	GOAL_FLAGS bit vector (low nibble); flags defined by goal type (high nibble)
 *		uint8_t length; 	//	Length of data[]
 *		uint8_t[] data; 	//	defined by goal type
 *	};
 *	and outputs the corresponding abstract object goal.
 */
function binGoalToAbstract(c) {
	if (c[0] >= CHALLENGE_DEFINITIONS.length)
		throw new TypeError("binGoalToAbstract: unknown challenge number " + String(c[0]));
	var template = CHALLENGE_DEFINITIONS[c[0]];
	var i, j, p, output, stringtype, maxIdx, tmp, err;
	var d = new TextDecoder;
	var rr = { paramList: [], valueList: [], typeList: [] };
		for (var n of Object.keys(template.params)) {
			rr[n] = { value: template.params[n], error: "" };
			rr.paramList.push(n);
			rr.typeList.push(template.paramTypes[n]);
		}

	var decoder = template.BinDecode;
	//	extract parameters and add them to rr
	for (i = 0; i < decoder.length; i++) {
		stringtype = false;

		p = decoder[i].param;
		if (decoder[i].type === "number") {
			//	Plain number
			output = [0];
			for (j = 0; j < decoder[i].size; j++) {
				//	little-endian, variable byte length, unsigned integer
				output[0] += c[GOAL_LENGTH + decoder[i].offset + j] * (1 << (8 * j));
			}

		} else if (decoder[i].type === "bool") {
			//	Boolean: reads one bit at the specified offset and position
			//	Note: offset includes goal's hidden flag for better packing when few flags are needed
			output = [(c[1 + decoder[i].offset] >> decoder[i].bit) & 0x01];
			if (decoder[i].formatter !== "")
				output[0]++;	//	hack for formatter offset below

		} else if (decoder[i].type === "string") {
			//	Plain string: copies a fixed-length or zero-terminated string into its replacement template site(s)
			stringtype = true;
			if (decoder[i].size == 0) {
				maxIdx = c.indexOf(0, GOAL_LENGTH + decoder[i].offset);
				if (maxIdx == -1)
					maxIdx = c.length;
			} else {
				maxIdx = decoder[i].size + GOAL_LENGTH + decoder[i].offset;
			}
			output = c.subarray(GOAL_LENGTH + decoder[i].offset, maxIdx);

		} else if (decoder[i].type === "pstr") {
			//	Pointer to string: reads a (byte) offset from target location, then copies from that offset
			stringtype = true;
			if (decoder[i].size == 0) {
				maxIdx = c.indexOf(0, GOAL_LENGTH + c[decoder[i].offset + GOAL_LENGTH]);
				if (maxIdx == -1)
					maxIdx = c.length;
			} else
				maxIdx = decoder[i].size + GOAL_LENGTH + c[decoder[i].offset + GOAL_LENGTH];
			output = c.subarray(GOAL_LENGTH + c[decoder[i].offset + GOAL_LENGTH], maxIdx);
		}

		if (decoder[i].formatter === "") {
			//	Unformatted number or string; if string, decode bytes from utf-8
			rr[p].value = stringtype ? d.decode(output) : output;
			rr[p].error = "";
		} else if (decoder[i].formatter === "bool") {
			rr[p].value = output == 2;
		} else {
			//	Formatted number/array; convert it
			if (ALL_ENUMS[decoder[i].formatter] === undefined)
				throw new TypeError("binGoalToAbstract: formatter \"" + decoder[i].formatter + "\" not found");
			tmp = []; err = "";
			for (j = 0; j < output.length; j++) {
				if (ALL_ENUMS[decoder[i].formatter][output[j] - 1] === undefined)
					err += "param " + p + " formatter " + decoder[i].formatter + " value " + String(output[j]) + " out of bounds, ";
				else
					tmp.push(ALL_ENUMS[decoder[i].formatter][output[j] - 1]);
			}
			if (decoder[i].size == 1)
				rr[p].value = tmp[0];
			else
				rr[p].value = tmp;
			rr[p].error = "";
			if (err > "") rr[p].error = "binGoalToAbstract " + err.substring(0, err.length - 2);
		}
	}
	for (var i = 0; i < rr.paramList.length; i++)
		rr.valueList.push(rr[rr.paramList[i]].value);
	rr.GoalName = template.RootGoal || template.GoalName;
	rr.GoalCategory = template.GoalCategory;
	rr.GoalComments = template.GoalComments;
	rr.GoalDesc = template.GoalDesc;
	rr.GoalPaint = template.GoalPaint;
	rr.BinEncode = template.BinEncode;
	return rr;
}

/**
 *	Converts a byte array to a "URL safe" base64 string,
 *	using these substitutions:
 *	'+' -> '-'
 *	'/' -> '_'
 *	'=' -> '*' (this one not very safe, unfortunately)
 */
function binToBase64u(a) {
	var s = btoa(String.fromCharCode.apply(null, a));
	return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "*");
}

/**
 *	Converts a "URL safe" base64 string to a byte array,
 *	using these substitutions:
 *	'-' -> '+'
 *	'_' -> '/'
 *	'*' -> '='
 */
function base64uToBin(s) {
	s = s.replace(/-/g, "+").replace(/_/g, "/").replace(/\*/g, "=");
	return new Uint8Array(atob(s).split("").map( c => c.charCodeAt(0) ));
}

/**
 *	Converts a string in the given shorthand named enum to its binary stored value.
 */
function enumToValue(s, en) {
	return ALL_ENUMS[en].indexOf(s) + 1;
}

/**
 *	Finds a string in the BingoEnum_CHALLENGES enum and converts to its binary
 *	value/index (the first selection from CHALLENGE_DEFINITIONS).
 *	Returns -1 if not found.
 */
function challengeValue(s) {
	return CHALLENGE_DEFINITIONS.findIndex(a => a.GoalName === s);
}

/**
 *	Apply a boolean (1 bit) to the array at given offset and bit position.
 *	a     array of length at least offs
 *	offs  offset to apply at
 *	bit   bit position to apply to
 *	n     integer to apply, little-endian, unsigned
 */
function applyBool(a, offs, bit, bool) {
	a[offs] &= ~(1 << bit);
	if (bool === ALL_ENUMS["boolean"][0]) return;
	a[offs] |= (1 << bit);
}

/**
 *	Apply a short integer (WORD) to the array at given offset.
 *	a     array of length at least offs + 2
 *	offs  offset to apply at
 *	n     integer to apply, little-endian, unsigned
 */
function applyShort(a, offs, n) {
	a[offs] = (n >>> 0) & 0xff; a[offs + 1] = (n >>> 8) & 0xff;
}

/**
 *	Apply a long integer (DWORD) to the array at given offset.
 *	a     array of length at least offs + 4
 *	offs  offset to apply at
 *	n     integer to apply, little-endian, unsigned
 */
function applyLong(a, offs, n) {
	a[offs + 0] = (n >>>  0) & 0xff; a[offs + 1] = (n >>>  8) & 0xff;
	a[offs + 2] = (n >>> 16) & 0xff; a[offs + 3] = (n >>> 24) & 0xff;
}

/**
 *	Read a short integer (WORD) from the array at given offset.
 *	a     array of length at least offs + 2
 *	offs  offset to apply at
 *	returns: unsigned, little-endian
 */
function readShort(a, offs) {
	return (a[offs] << 0) + (a[offs + 1] << 8);
}

/**
 *	Read a long integer (DWORD) from the array at given offset.
 *	a     array of length at least offs + 4
 *	offs  offset to apply at
 *	returns: unsigned, little-endian
 */
function readLong(a, offs) {
	return (a[offs] << 0) + (a[offs + 1] << 8) + (a[offs + 2] << 16) + (a[offs + 3] * (1 << 24));
}

function entityToColor(i) {
	return itemNameToIconColorMap[i] || creatureNameToIconColorMap[i] || itemNameToIconColorMap["Default"];
}

/**
 *	Looks up the creature/item identifier in the respective DisplayTextMap
 *	variable, or uses s verbatim if not found.
 *	Default: for n != 1, concatenates number, space, name.
 *	For n == 1, tests for special cases (ref: creatureNameToDisplayTextMap,
 *	itemNameToDisplayTextMap), converting it to the English singular case
 *	("a Batfly", etc.).
 *	@param n  entity quantity/amount
 *	@param s  entity identifier, or any string ending in a plural
 */
function entityNameQuantify(n, s) {
	s = itemNameToDisplayTextMap[s] || creatureNameToDisplayTextMap[s] || s;
	if (n != 1)
		return String(n) + " " + s;
	s = s.replace(/Mice$/, "Mouse").replace(/ies$/, "y").replace(/ches$/, "ch").replace(/s$/, "");
	if (/^[AEIOU]/i.test(s))
		s = "an " + s;
	else
		s = "a " + s;
	return s;
}

/**
 *	TODO: refactor out
 *	Check if the specified challenge descriptor SettingBox string matches
 *	the asserted value.  Helper function for CHALLENGES functions.
 *	@param t    string, name of calling object/junction
 *	@param d    string to parse and verify (e.g. "System.String|selectedItem|LabelText|itemIndex|list")
 *	@param f    array of values to compare to; length must match, empty elements are ignored
 *	@param err  string, text to include in the error
 *	@throws TypeError if invalid
 */
function checkSettingbox(t, d, f, err) {
	var items = d.split("|");
	if (items.length != f.length) throw new TypeError(t + ": " + err + ", found "
			+ String(items.length) + " items, expected: " + String(f.length));
	for (var i = 0; i < items.length; i++) {
		if (f[i] !== undefined && items[i] != f[i])
			throw new TypeError(t + ": " + err + ", found \"" + items[i] + "\", expected: \"" + String(f[i]) + "\"");
	}
	return items;
}

/**
 *	TODO: refactor out
 *	Check if the specified challenge descriptor matches the asserted value.
 *	Helper function for CHALLENGES functions.
 *	@param t    string, name of calling object/junction
 *	@param d    value to check equality of
 *	@param g    value comparing to
 *	@param err  string, text to include in the error
 *	@throws TypeError on mismatch
 */
function checkDescriptors(t, d, g, err) {
	var s = String(d), h = String(g);
	if (typeof(d) === "string") s = "\"" + s + "\"";
	if (typeof(g) === "string") h = "\"" + h + "\"";
	if (d != g) throw new TypeError(t + ": error, " + err + " " + s + ", expected: " + h);
}

/**
 *	Generate a valid? link to the RW map viewer, of the specified room,
 *	and current global state (board.character, map_link_base).
 */
function getMapLink(room) {
	if (map_link_base === "")
		return "";
	var reg = regionOfRoom(room);
	var ch = Object.keys(BingoEnum_CharToDisplayText)[
			Object.values(BingoEnum_CharToDisplayText).indexOf(board.character)] || "White";
	ch = ch.toLowerCase();
	return "<br><a href=\"" + map_link_base + "?slugcat=" + ch + "&region=" + reg + "&room=" + room
			+ "\" target=\"_blank\">" + room + " on Rain World Downpour Map" + "</a>";
}

/**
 *	Extract region code from given room code string.
 *	All extant regions follow this pattern, so, probably safe enough?
 */
function regionOfRoom(r) {
	return r.substring(0, r.search("_"));
}

/**
 *	Populates the document with checkboxes tagged according to a `perks` bitmask.
 */
function perksToChecksList(p) {
	var elem = document.getElementById("hdrperks");
	while (elem.childNodes.length) elem.removeChild(elem.childNodes[0]);
	var l = Object.keys(BingoEnum_EXPFLAGS);
	for (var i = 0; i < l.length; i++) {
		var label = document.createElement("label");
		var check = document.createElement("input");
		check.setAttribute("type", "checkbox");
		check.setAttribute("id", "perkscheck" + String(i));
		if (p & BingoEnum_EXPFLAGS[l[i]])
			check.setAttribute("checked", "");
		label.appendChild(check);
		label.appendChild(document.createTextNode(BingoEnum_EXPFLAGSNames[l[i]]));
		elem.appendChild(label);
	}
}

/**
 *	Sets header mod information from the provided array:
 *	m = [
 *		{ name: "mod name", hash: "caf3bab3" },
 *		...
 *	]
 */
function addModsToHeader(m) {
	var elem = document.getElementById("hdrmods");
	while (elem.childNodes.length) elem.removeChild(elem.childNodes[0]);
	if (!m.length) {
		elem.appendChild(document.createTextNode("none"));
		return;
	}
	var td = document.createElement("td");
	var tr = document.createElement("tr");
	var tbl = document.createElement("table");
	td.appendChild(document.createTextNode("Number"));
	tr.appendChild(td);
	td = document.createElement("td");
	td.appendChild(document.createTextNode("Hash"));
	tr.appendChild(td);
	td = document.createElement("td");
	td.appendChild(document.createTextNode("Name"));
	tr.appendChild(td);
	tbl.appendChild(tr); elem.appendChild(tbl);
	for (var i = 0; i < m.length; i++) {
		tr = document.createElement("tr");
		tbl.appendChild(tr);
		td = document.createElement("td");
		td.appendChild(document.createTextNode(String(i)));
		td.style.textAlign = "center";
		tr.appendChild(td);
		td = document.createElement("td");
		td.appendChild(document.createTextNode(m[i].hash));
		tr.appendChild(td);
		td = document.createElement("td");
		td.appendChild(document.createTextNode(m[i].name));
		tr.appendChild(td);
	}
}

/**
 *	Quickly sets the meta / header data for a parsed text board.
 *	Has no effect if the header table is not yet placed.
 *	@param comm   String to set as comment / title
 *	  character   Selected character; one of Object.values(BingoEnum_CharToDisplayText), or "Any" if other
 *	    shelter   Shelter to start in, or "" if random.
 *	      perks   List of perks to enable.  Array of integers, each indexing ALL_ENUMS.EXPFLAGS[]
 *	              and respective enums (see also BingoEnum_EXPFLAGSNames).
 *	              For example, the list [0, 5, 13, 14, 16] would enable:
 *	              "Perk: Scavenger Lantern", "Perk: Karma Flower", "Perk: Item Crafting",
 *	              "Perk: High Agility", "Burden: Blinded"
 *	              (Ordering of this array is not checked, and repeats are ignored.)
 *	Parameters are optional; an absent parameter leaves the existing value alone.
 *	Call with no parameters to get usage.
 */
function setMeta() {
	var comm = arguments[0], character = arguments[1];
	var shelter = arguments[2], perks = arguments[3];

	if (board === undefined || document.getElementById("hdrttl") === null
			|| document.getElementById("hdrchar") === null
			|| getElementContent("hdrshel") === null) {
		console.log("Need a board to set.");
		return;
	}

	if (comm !== undefined)
		document.getElementById("hdrttl").value = comm;
	if (character !== undefined)
		document.getElementById("hdrchar").innerText = character;
	if (shelter !== undefined) {
		if (shelter === "random") shelter = "";
		document.getElementById("hdrshel").value = shelter;
	}
	if (perks !== undefined) {
		for (var i = 0, el; i < Object.values(BingoEnum_EXPFLAGS).length; i++) {
			el = document.getElementById("perkscheck" + String(i));
			if (el === null)
				break;
			if (perks.includes(i))
				el.setAttribute("checked", "");
			else
				el.removeAttribute("checked");
		}
	}
	if (comm !== undefined || character !== undefined
			|| shelter !== undefined || perks !== undefined) {
		console.log("Updated.");
		parseText();
		return;
	}
	console.log("setMeta(comm, character, shelter, perks)\n"
	          + "Quickly sets the meta / header data for a parsed text board.\n"
	          + "     comm   String to set as comment / title\n"
	          + "character   Selected character; one of Object.values(BingoEnum_CharToDisplayText), or \"Any\" if other.\n"
	          + "  shelter   Shelter to start in, or \"\" if random.\n"
	          + "    perks   List of perks to enable.  Array of integers, each indexing ALL_ENUMS.EXPFLAGS[] and\n"
	          + "respective enums (e.g. BingoEnum_EXPFLAGSNames). For example, the list [0, 5, 13, 14, 16] would\n"
	          + "enable: \"Perk: Scavenger Lantern\", \"Perk: Karma Flower\", \"Perk: Item Crafting\", \"Perk: High Agility\",\n"
	          + "\"Burden: Blinded\". (Ordering of this array doesn't matter, and repeats are ignored.)\n"
	          + "Parameters are optional; an absent parameter leaves the existing value alone. Call with no parameters\n"
	          + "to get usage.\n"
	          + "Example:  setMeta(\"New Title\", \"White\", \"SU_S05\", [])\n"
	          + "-> sets the title, character and shelter, and clears perks.\n"
	);
}
