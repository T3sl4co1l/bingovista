/*
 *	bingovista.js
 *	RW Bingo Board Viewer JS module
 *	(c) 2025 T3sl4co1l
 *	some more TODOs:
 *	- [DONE] categorize vista points by source (stock = base game; bingo extended = from mod; or other strings from modpacks)
 *	- nudge around board view by a couple pixels to spread out rounding errors
 *	- board server to...basically URL-shorten?
 *	--> practically done; service is currently active, but no submission portal yet; manual submissions are possible
 *	- ???
 *	- no profit, this is for free GDI
 *	- Streamline challenge parsing? compactify functions? or reduce to structures if possible?
 *	--> planned for v2.0 but will take a while
 *	
 *	Stretchier goals:
 *	- Board editing, of any sort
 *	    * Drag and drop to move goals around
 *		* Make parameters editable
 *		* Port generator code to C#??
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
	{ img: "atlases/bvicons.png",      txt: "atlases/bvicons.txt",      canv: undefined, frames: {} },	/**< anything not found below */
	{ img: "atlases/bingoicons.png",   txt: "atlases/bingoicons.txt",   canv: undefined, frames: {} },	/**< from Bingo mod */
	{ img: "atlases/uispritesmsc.png", txt: "atlases/uispritesmsc.txt", canv: undefined, frames: {} }, 	/**< from DLC       */
	{ img: "atlases/uiSprites.png",    txt: "atlases/uiSprites.txt",    canv: undefined, frames: {} } 	/**< from base game */
];

/**
 *	Bingo square graphics, dimensions (in px) and other properties.
 *	Read by clickBoard, redrawBoard, selectSquare and setCursor.
 *	set by parseButton to fit to canvas.
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
const VERSION_MAJOR = 1, VERSION_MINOR = 25;

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
 *				name: "BingoGoalName", // name of CHALLENGES method which produced it
 *				category: <string>,
 *				items: [(<string>, ...)],
 *				values: [(<string>, ...)],
 *				description: <string>,
 *				comments: <string>,
 *				paint: [
 *					//	any of the following, in any order:
 *					{ type: "icon", value: <string>, scale: <number>, color: <HTMLColorString>, rotation: <number> },
 *					{ type: "break" },
 *					{ type: "text", value: <string>, color: <HTMLColorString> },
 *				],
 *				toBin: <Uint8Array>	//	binary format of goal
 *			},
 *
 *			( . . . )
 *
 *		],
 *		text: <string>,    	//	text format of whole board, including meta supported by current version
 *		toBin: <Uint8Array>	//	binary format of whole board, including meta and concatenated goals
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

/** Flag to transpose the board (visual compatibility >= v1.25) */
var transpose = true;


/* * * Functions * * */

/* * * Event Listeners and Initialization * * */

document.addEventListener("DOMContentLoaded", function() {

	//	Data structure cleanup and inits and checks, things that couldn't be statically initialized, etc.
	expandAndValidateLists();
	initGenerateBlacklist();
	square.color = RainWorldColors.Unity_white;

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
				return reject(new DOMException("URL " + response.url + " error " + response.status + " " + response.statusText + ".", "NetworkError"));
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
			parseButton();

		} else if (u.has("b")) {

			//	Binary string, base64 encoded
			var ar;
			try {
				ar = base64uToBin(u.get("b"));	//	Undo URL-safe escapes...
			} catch (e) {
				setError("Error parsing URL: " + e.message);
			}
			try {
				board = binToString(ar);
			} catch (e) {
				setError("Error decoding board: " + e.message);
			}
			document.getElementById("textbox").value = board.text;
			setHeaderFromBoard(board);
			parseButton();

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
				setHeaderFromBoard(board);
				parseButton();
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
});

/**
 *	Set header table from board data as returned from binToString.
 */
function setHeaderFromBoard(b) {
	var el = document.getElementById("hdrttl");
	while (el.childNodes.length) el.removeChild(el.childNodes[0]);
	el.appendChild(document.createTextNode(b.comments || "Untitled"));
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
 *	Redraws a board on a canvas.
 *	@param {string} [canvas] The `id` of the canvas to draw on.
 *	@param {*} [board] board structure (see global `board`).
 */
function redrawBoard(canvasId, board) {
	const canvas = document.getElementById(canvasId);
	canvas.dataset.width = board.width;
	canvas.dataset.height = board.height;

	var goalSquare = {}; Object.assign(goalSquare, square)
	goalSquare.margin = Math.max(Math.round((canvas.width + canvas.height) * 2 / ((board.width + board.height) * 91)) * 2, 2);
	goalSquare.width = Math.round((canvas.width / board.width) - goalSquare.margin - goalSquare.border);
	goalSquare.height = Math.round((canvas.height / board.height) - goalSquare.margin - goalSquare.border);

	var ctx = canvas.getContext("2d");
	ctx.fillStyle = goalSquare.background;
	ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
	for (var i = 0; i < board.goals.length; i++) {
		var x, y, t;
		x = Math.floor(i / board.height) * (goalSquare.width + goalSquare.margin + goalSquare.border)
				+ (goalSquare.border + goalSquare.margin) / 2;
		y = (i % board.height) * (goalSquare.height + goalSquare.margin + goalSquare.border)
				+ (goalSquare.border + goalSquare.margin) / 2;
		if (transpose) {
			t = y; y = x; x = t;
		}
		drawSquare(ctx, board.goals[i], x, y, goalSquare);
	}
}

/**
 *	Select the square at (col, row) on canvas canvasId to show details of.
 *	If either argument is out of range, clears the selection instead.
 */
function selectSquare(col, row, canvasId) {
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

	setCursor(row, col, canvasId);

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
 *	Position cursor
 */
function setCursor(row, col, canvasId) {
	const canvas = document.getElementById(canvasId);
	var goalSquare = {}; Object.assign(goalSquare, square);
	goalSquare.margin = Math.max(Math.round((canvas.width + canvas.height) * 2 / ((parseInt(canvas.dataset.width) + parseInt(canvas.dataset.height)) * 91)) * 2, 2);
	goalSquare.width = Math.round((canvas.width / parseInt(canvas.dataset.width)) - goalSquare.margin - goalSquare.border);
	goalSquare.height = Math.round((canvas.height / parseInt(canvas.dataset.height)) - goalSquare.margin - goalSquare.border);

	//	Firefox border offset bug
	var fixX = 0, fixY = 1;
	if (typeof mozInnerScreenX !== 'undefined' || typeof InstallTrigger !== 'undefined') {
		fixY = 0;
	}
	var curSty = document.getElementById("cursor").style;
	curSty.width  = String(goalSquare.width  + goalSquare.border - 5 - fixX) + "px";
	curSty.height = String(goalSquare.height + goalSquare.border - 4 - fixY) + "px";
	var x = goalSquare.margin / 2 - 1 + col * (goalSquare.width + goalSquare.margin + goalSquare.border);
	var y = goalSquare.margin / 2 + 0 + row * (goalSquare.height + goalSquare.margin + goalSquare.border);
	if (transpose) [x, y] = [y, x];
	curSty.left = String(x + fixX) + "px"; curSty.top  = String(y + fixY) + "px";
	curSty.display = "initial";
}

/**
 *	Draw a challenge square to the specified canvas at the specified location (top-left corner).
 */
function drawSquare(ctx, goal, x, y, size) {
	ctx.beginPath();
	ctx.strokeStyle = size.color;
	ctx.lineWidth = size.border;
	ctx.roundRect(x, y, size.width, size.height, 4);
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
 *	Parse a board in text format.
 *	Returns an abstract board object.
 *	Optional metadata, that aren't set in the board string, are left
 *	as "".  These are comments, character and shelter.
 */
function parseText(s) {
	var goals = s.split(/bChG/);
	goals.forEach((s, i) => goals[i] = s.trim());
	var size = Math.ceil(Math.sqrt(goals.length));
	var board = {
		comments: "",
		character: "",
		perks: undefined,
		shelter: "",
		mods: [],
		size: size,
		width: size,
		height: size,
		goals: [],
		toBin: undefined
	};

	//	Detect board version:
	//	assertion: no challenge names are shorter than 14 chars (true as of 1.25)
	//	assertion: no character names are longer than 10 chars (true of base game + Downpour + Watcher)
	//	1.27+: character prefix, ";" delimited --> check within first 12 chars
	//	0.90: character prefix, ";" delimited --> check within first 12 chars
	//	0.86: character prefix, "_" delimited --> check within first 12 chars
	//	0.85: no prefix, gonzo right into the goal list --> first token (to "~") is valid goal name or error
	var semicolon = goals[0].indexOf(";"), underscore = goals[0].indexOf("_");
	if (goals[0].search(/[A-Za-z]{1,12}[_;]/) == 0) {
		//	Seems 0.86 or later, find which
		if (semicolon > 0) {
			var secondcolon = goals[0].indexOf(";", semicolon + 1);
			if (secondcolon > 0) {
				board.version = "1.3";
				var header = goals[0].split(";");
				board.character = header[0];
				board.shelter = header[1];
				goals[0] = header[header.length - 1];
				// future up-version checks here: perks, etc.
			} else {
				board.version = "0.90";
				board.character = goals[0].substring(0, semicolon);
				goals[0] = goals[0].substring(semicolon + 1);
			}
		} else if (underscore > 0) {
			board.version = "0.86";
			board.character = goals[0].substring(0, underscore);
			goals[0] = goals[0].substring(underscore + 1);
		}
		board.character = BingoEnum_CharToDisplayText[board.character] || "";
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
					board.goals.push(CHALLENGES[type](desc, board));
				} catch (er) {
					board.goals.push(CHALLENGES["BingoChallenge"]( [
						"Error: " + er.message + "; descriptor: " + desc.join("><") ], board));
				}
			} else {
				board.goals.push(CHALLENGES["BingoChallenge"]( ["Error: unknown type: [" + type + "," + desc.join(",") + "]"], board));
			}
		} else {
			board.goals.push(CHALLENGES["BingoChallenge"]( ["Error extracting goal: " + goals[i]], board));
		}
	}
	if (goals.length == 0)
		board.goals.push(CHALLENGES["BingoChallenge"]( ["blank"], board));

	//	collect or re-set the binary format and we're done
	board.toBin = boardToBin(board);

	return board;
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
	//gLen = Math.ceil(gLen / 3) * 3;	//	round up to pad with zeroes; no effect on board, removes base64 padding
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
 *	Converts binary format to a board in text format.
 */
function binToString(a) {
	//	Minimum size to read full header
	if (a.length < HEADER_LENGTH)
		throw new TypeError("binToString: insufficient data, found " + String(a.length) + ", expected: " + String(HEADER_LENGTH) + " bytes");
	//	uint32_t magicNumber;
	if (readLong(a, 0) != 0x69427752)
		throw new TypeError("binToString: unknown magic number: 0x" + readLong(a, 0).toString(16) + ", expected: 0x69427752");
	//	(6, 7) uint8_t boardWidth; uint8_t boardHeight;
	var b = {
		comments: "",
		character: "",
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
	b.text = (a[8] == 0) ? "Any" : Object.keys(BingoEnum_CharToDisplayText)[a[8] - 1];
	b.character = BingoEnum_CharToDisplayText[b.text] || "Any";
	b.text += ";";
	//	uint16_t shelter;
	var ptr = readShort(a, 9);
	if (ptr > 0) {
		if (ptr >= a.length)
			throw new TypeError("binToString: shelter pointer 0x" + ptr.toString(16) + " out of bounds");
		if (a.indexOf(0, ptr) < 0)
			throw new TypeError("binToString: shelter missing terminator");
		b.shelter = d.decode(a.subarray(ptr, a.indexOf(0, ptr)));
	}
	//	uint32_t perks;
	b.perks = readLong(a, 11);
	//	uint16_t mods;
	ptr = readShort(a, 17);
	if (ptr > 0) {
		if (ptr >= a.length)
			throw new TypeError("binToString: mods pointer 0x" + ptr.toString(16) + " out of bounds");
		b.mods = readMods(a, ptr);
	}
	//	uint16_t reserved;
	if (readShort(a, 19) != 0)
		throw new TypeError("binToString: reserved: 0x" + readShort(a, 19).toString(16) + ", expected: 0x0");
	//	(21) uint8_t[] comments;
	if (a.indexOf(0, HEADER_LENGTH) < 0)
		throw new TypeError("binToString: comments missing terminator");
	b.comments = d.decode(a.subarray(HEADER_LENGTH, a.indexOf(0, HEADER_LENGTH)));

	//	uint16_t goals;
	ptr = readShort(a, 15);
	if (ptr == 0 || ptr >= a.length)
		throw new TypeError("binToString: goals pointer 0x" + ptr.toString(16) + " out of bounds");
	var goal, type, desc;
	for (var i = 0; i < b.width * b.height && ptr < a.length; i++) {
		var sa = a.subarray(ptr, ptr + a[ptr + 2] + GOAL_LENGTH);
		if (sa.length < GOAL_LENGTH) break;
		try {
			goal = binGoalToText(sa);
		} catch (er) {
			goal = "BingoChallenge~Error: " + er.message + ", len " + sa.length + ", bytes [" + sa.join(",") + "]><";
		}
		ptr += GOAL_LENGTH + a[ptr + 2];
		//	could also, at this point, enumerate goals in the data structure; need a direct binary to JS codec
		//[type, desc] = goal.split("~");
		//desc = desc.split(/></);
		//board.goals.push(CHALLENGES[type](desc));
		b.text += goal + "bChG";
	}
	b.text = b.text.replace(/bChG$/, "");

	return b;

	function readMods(c, offs) {
		return [];
	}

}

/**
 *	Reads the given [sub]array as a binary challenge:
 *	struct bingo_goal_s {
 *		uint8_t type;   	//	BINGO_GOALS index
 *		uint8_t flags;  	//	GOAL_FLAGS bit vector
 *		uint8_t length; 	//	Length of data[]
 *		uint8_t[] data; 	//	defined by the goal
 *	};
 *	and outputs the corresponding text formatted goal.
 */
function binGoalToText(c) {
	var s, p, j, k, outputs, stringtype, maxIdx, replacer, tmp;
	var d = new TextDecoder;

	if (c[0] >= BINARY_TO_STRING_DEFINITIONS.length)
		throw new TypeError("binGoalToText: unknown challenge type " + String(c[0]));
	//	ignore flags, not supported in 0.90 text
	//c[1]
	s = BINARY_TO_STRING_DEFINITIONS[c[0]].desc;
	p = BINARY_TO_STRING_DEFINITIONS[c[0]].params;
	//	extract parameters and make replacements in s
	for (j = 0; j < p.length; j++) {
		stringtype = false;

		if (p[j].type === "number") {
			//	Plain number: writes a decimal integer into its replacement template site(s)
			outputs = [0];
			for (k = 0; k < p[j].size; k++) {
				//	little-endian, variable byte length, unsigned integer
				outputs[0] += c[GOAL_LENGTH + p[j].offset + k] * (1 << (8 * k));
			}
			if (p[j].signed && p[j].formatter == "" && outputs[0] >= (1 << (k * 8 - 1)))
				outputs[0] = outputs[0] - (1 << (k * 8));

		} else if (p[j].type === "bool") {
			//	Boolean: reads one bit at the specified offset and position
			//	Note: offset includes goal's hidden flag for better packing when few flags are needed
			outputs = [(c[1 + p[j].offset] >> p[j].bit) & 0x01];
			if (p[j].formatter !== "")
				outputs[0]++;	//	hack for formatter offset below

		} else if (p[j].type === "string") {
			//	Plain string: copies a fixed-length or zero-terminated string into its replacement template site(s)
			stringtype = true;
			if (p[j].size == 0) {
				maxIdx = c.indexOf(0, GOAL_LENGTH + p[j].offset);
				if (maxIdx == -1)
					maxIdx = c.length;
			} else
				maxIdx = p[j].size + GOAL_LENGTH + p[j].offset;
			outputs = c.subarray(GOAL_LENGTH + p[j].offset, maxIdx);

		} else if (p[j].type === "pstr") {
			//	Pointer to string: reads a (byte) offset from target location, then copies from that offset
			stringtype = true;
			if (p[j].size == 0) {
				maxIdx = c.indexOf(0, GOAL_LENGTH + c[p[j].offset + GOAL_LENGTH]);
				if (maxIdx == -1)
					maxIdx = c.length;
			} else
				maxIdx = p[j].size + GOAL_LENGTH + c[p[j].offset + GOAL_LENGTH];
			outputs = c.subarray(GOAL_LENGTH + c[p[j].offset + GOAL_LENGTH], maxIdx);
		}

		var f = p[j].formatter;
		if (f === "") {
			if (stringtype) {
				//	Unformatted string, decode bytes into utf-8
				replacer = d.decode(outputs);
			} else {
				//	single number, toString it
				replacer = String(outputs[0]);
			}
		} else {
			//	Formatted number/array, convert it and join
			if (ALL_ENUMS[f] === undefined)
				throw new TypeError("binGoalToText: formatter \"" + f + "\" not found");
			tmp = [];
			for (k = 0; k < outputs.length; k++) {
				if (p[j].altthreshold === undefined || outputs[k] < p[j].altthreshold) {
					if (ALL_ENUMS[f][outputs[k] - 1] === undefined)
						throw new TypeError("binGoalToText: formatter \"" + f + "\", value out of range: " + String(outputs[k]));
					tmp.push(ALL_ENUMS[f][outputs[k] - 1]);
				} else {
					if (ALL_ENUMS[p[j].altformatter][outputs[k] - p[j].altthreshold] === undefined)
						throw new TypeError("binGoalToText: alternative formatter \"" + p[j].altformatter + "\", value out of range: " + String(outputs[k]));
					tmp.push(ALL_ENUMS[p[j].altformatter][outputs[k] - p[j].altthreshold]);
				}
			}
			replacer = tmp.join(p[j].joiner || "");
		}
		s = s.replace(RegExp("\\{" + String(j) + "\\}", "g"), replacer);
	}
	s =
			(ChallengeUpgrades[BINARY_TO_STRING_DEFINITIONS[c[0]].name]
			|| BINARY_TO_STRING_DEFINITIONS[c[0]].name)
			+ "~" + s;
	return s;
}

/**
 *	Challenge classes; used by parseText().
 *	From Bingomod decomp/source, with some customization (particularly across
 *	versions).
 *
 *	Called with parameters:
 *	desc    list of goal parameters to parse (goal_text.split("><"))
 *	board   (to be) global board object, under construction; header/meta properties
 *	can be read from here.
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
 *	etc.  See: ChallengeUpgrades and BINARY_TO_STRING_DEFINITIONS.
 *
 *	Maintain sync between CHALLENGES, BINARY_TO_STRING_DEFINITIONS and
 *	BingoEnum_CHALLENGES.
 */
const CHALLENGES = {
	BingoChallenge: function(desc, board) {
		const thisname = "BingoChallenge";
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
			items: [],	/**< items and values arrays must have equal length */
			values: [],
			description: desc[0],	/**< HTML allowed for other goals (not this one) */
			comments: "",	/**< HTML allowed */
			paint: [
				{ type: "text", value: "∅", color: RainWorldColors.Unity_white }
			],
			toBin: b.subarray(0, enc.length + GOAL_LENGTH)
		};
	},
	BingoAchievementChallenge: function(desc, board) {
		const thisname = "BingoAchievementChallenge";
		//	assert: desc of format ["System.String|Traveller|Passage|0|passage", "0", "0"]
		const upgrades = {};
		desc = upgradeDescriptor(desc, upgrades);
		const template = [
			{ param: "passage",  type: "string", formatter: "passage", parse: "SettingBox", parseFmt: { datatype: "System.String", name: "Passage", position: "0", formatter: "passage", altformatter: "", altthreshold: 0, defaultval: "Traveller" } },
			{ param: "completed", type: "number", formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0 },
			{ param: "revealed",  type: "number", formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0 }
		];
		var params = challengeTextToAbstract(desc, template);
		params._name = thisname;
		params._board = board;
		function AchievementChallengePaint(p) {
			return [
				{ type: "icon", value: "smallEmptyCircle", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: p.passage + "A", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "smallEmptyCircle", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 }
			];
		}
		function AchievementChallengeDescription(p) {
			return "Earn " + (passageToDisplayNameMap[p.passage] || "unknown") + " passage.";
		}
		function AchievementChallengeComment(p) {
			return "";
		}
		function AchievementChallengeToBinary(p) {
			var b = Array(4); b.fill(0);
			b[0] = challengeValue(p._name);
			b[3] = enumToValue(p.passage, "passage");
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
		return {
			name: thisname,
			params: params,
			category: "Obtaining Passages",
			items: ["passage"],
			values: [params.passage],
			description: AchievementChallengeDescription(params),
			comments: AchievementChallengeComment(params),
			paint: AchievementChallengePaint(params),
			toBin: AchievementChallengeToBinary(params)
		};
	},
	BingoAllRegionsExcept: function(desc, board) {
		const thisname = "BingoAllRegionsExcept";
		//	desc of format ["System.String|UW|Region|0|regionsreal", "SU|HI|DS|CC|GW|SH|VS|LM|SI|LF|UW|SS|SB|LC", "0", "System.Int32|13|Amount|1|NULL", "0", "0"]
		const upgrades = {
			6: [ { op: "intFormat", offs: 3, before: "System.Int32|", after: "|Amount|1|NULL" } ]
		};
		const template = [
			{ param: "region",  type: "string", formatter: "regions", parse: "SettingBox", parseFmt: { datatype: "System.String", name: "Region", position: "0", formatter: "regionsreal", defaultval: "SU" } },
			{ param: "remaining", type: "array", formatter: "regionsreal", parse: "list", separator: "|", defaultval: [] },
			{ param: "current", type: "number", formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0 },
			{ param: "amount",  type: "number", formatter: "", parse: "SettingBox", parseFmt: { datatype: "System.Int32", name: "Amount", position: "1", formatter: "NULL", minval: 0, maxval: INT_MAX, defaultval: 1 } },
			{ param: "completed", type: "number", formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0 },
			{ param: "revealed",  type: "number", formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0 }
		];
		var params = challengeTextToAbstract(desc, template);
		params._name = thisname;
		params._board = board;
		function AllRegionsExceptToPaint(p) {
			return [
				{ type: "icon", value: "TravellerA", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "buttonCrossA", scale: 1, color: RainWorldColors.Unity_red, rotation: 0 },
				{ type: "text", value: p.region, color: RainWorldColors.Unity_white },
				{ type: "break" },
				{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: RainWorldColors.Unity_white }
			];
		}
		function AllRegionsExceptToDescription(p) {
			return "Enter " + (((p.amount - p.current) > 1) ? String(p.amount - p.current) + " more regions" : (((p.amount - p.current) > 0) ? "one more region" : "no more regions") ) + " without entering " + regionToDisplayText(p._board.character, p.region, "Any Subregion") + ".";
		}
		function AllRegionsExceptToComment(p) {
			return "This challenge is potentially quite customizable; only regions in the list need to be entered. Normally, the list is populated with all campaign story regions (i.e. corresponding Wanderer pips), so that progress can be checked on the sheltering screen. All that matters towards completion, is Progress equaling Total; thus we can set a lower bar and play a \"The Wanderer\"-lite; or we could set a specific collection of regions to enter, to entice players towards them. Downside: the latter functionality is not currently supported in-game: the region list is something of a mystery unless viewed and manually tracked. (This goal generates with all regions listed, so that all will contribute towards the goal.)";
		}
		function AllRegionsExceptToBinary(p) {
			var b = Array(5); b.fill(0);
			b[0] = challengeValue(p._name);
			b[3] = enumToValue(p.region, "regionsreal");
			b[4] = Math.max(0, Math.min(p.required - p.current, CHAR_MAX));
			p.remaining.forEach(s => b.push(enumToValue(s, "regionsreal")) );
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
		var v = [], i = [];
		v.push(String(params.region));    i.push("region");
		v.push(params.remaining.join(params._templates.remaining.separator)); i.push("remaining");
		v.push(String(params.current));   i.push("current");
		v.push(String(params.amount));    i.push("amount");
		return {
			name: thisname,
			params: params,
			category: "Entering regions while never visiting one",
			items: i,
			values: v,
			description: AllRegionsExceptToDescription(params),
			comments: AllRegionsExceptToComment(params),
			paint: AllRegionsExceptToPaint(params),
			toBin: AllRegionsExceptToBinary(params)
		};
	},
	BingoBombTollChallenge: function(desc, board) {
		const thisname = "BingoBombTollChallenge";
		//	desc of format (< v1.2) ["System.String|gw_c05|Scavenger Toll|1|tolls", "System.Boolean|false|Pass the Toll|0|NULL", "0", "0"]
		//	or (>= 1.2) ["System.Boolean|true|Specific toll|0|NULL", "System.String|gw_c05|Scavenger Toll|3|tolls", "System.Boolean|false|Pass the Toll|2|NULL", "0", "System.Int32|3|Amount|1|NULL", "empty", "0", "0"]
		const upgrades = {
			4: [	//	< v1.2
				{ op: "splice", offs: 2, rem: 0, data: ["0", "System.Int32|3|Amount|1|NULL", "empty"] },
				{ op: "unshift", data: "System.Boolean|true|Specific toll|0|NULL" }
			]
		};
		desc = upgradeDescriptor(desc, upgrades);
		const template = [
			{ param: "specific",  type: "bool",   formatter: "", parse: "SettingBox", parseFmt: { datatype: "System.Boolean", name: "Specific toll", position: "0", formatter: "NULL", defaultval: false } },
			{ param: "roomName",  type: "string", formatter: "tolls", parse: "SettingBox", parseFmt: { datatype: "System.String", name: "Scavenger Toll", position: "3", formatter: "tolls", altformatter: "", altthreshold: 0, defaultval: "su_c02" } },
			{ param: "pass",      type: "bool",   formatter: "", parse: "SettingBox", parseFmt: { datatype: "System.Boolean", name: "Pass the Toll", position: "2", formatter: "NULL", defaultval: false } },
			{ param: "current",   type: "number", formatter: "", parse: "parseInt", minval: 0, maxval: CHAR_MAX, defaultval: 0 },
			{ param: "amount",    type: "number", formatter: "", parse: "SettingBox", parseFmt: { datatype: "System.Int32", name: "Amount", position: "1", formatter: "NULL", minval: 0, maxval: CHAR_MAX, defaultval: 1 } },
			{ param: "bombed",    type: "list",   formatter: "tolls_bombed", parse: "list", separator: "%", minval: 1, defaultval: "empty" },
			{ param: "completed", type: "number", formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0 },
			{ param: "revealed",  type: "number", formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0 }
		];
		var params = challengeTextToAbstract(desc, template);
		params._name = thisname;
		params._board = board;
		function BombTollChallengeToPaint(p) {
			var r = [
				{ type: "icon", value: "Symbol_StunBomb", scale: 1, color: entityIconColor("ScavengerBomb"), rotation: 0 },
				{ type: "icon", value: "scavtoll", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: p.specific ? p.roomName.toUpperCase() : ("[" + String(p.current) + "/" + String(p.amount) + "]"), color: RainWorldColors.Unity_white }
			];
			if (p.pass)
				r.splice(2, 0, { type: "icon", value: "singlearrow", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
			return r;
		}
		function BombTollChallengeToComments(p) {
			return "A hit is registered within a 500-unit radius of the toll. Bomb and pass can be done in either order within a cycle; or even bombed in a previous cycle, then passed later.<br>" +
				"When the <span class=\"code\">specific</span> flag is set, <span class=\"code\">amount</span> and <span class=\"code\">current</span> are unused; when cleared, <span class=\"code\">Scavenger Toll</span> is unused.<br>" +
				"The <span class=\"code\">bombed</span> list records the state of the multi-toll version. It's a dictionary of the form: <span class=\"code\">{room name}|{false/true}[%...]</span>, where the braces are replaced with the respective values, and <span class=\"code\">|</span> and <span class=\"code\">%</span> are literal, and (\"...\") indicates subsequent key-value pairs; or <span class=\"code\">empty</span> when empty. (Room names are case-sensitive, matching the game-internal naming.)  A room is added to the list when bombed, with a Boolean value of <span class=\"code\">false</span> before passing, or <span class=\"code\">true</span> after. By preloading this list, a customized \"all but these tolls\" challenge could be crafted (but, do note the list does not show in-game!)." + getMapLink(p.roomName.toUpperCase(), p._board.character);
		}
		function BombTollChallengeToDescription(p) {
			var d;
			if (p.specific) {
				var regi = regionOfRoom(p.roomName).toUpperCase();
				if (BingoEnum_AllRegionCodes.indexOf(regi) < 0)
					throw new TypeError(thisname + ": region \"" + regi + "\" not found in AllRegionCodes[]");
				var r = regionToDisplayText(p._board.character, regi, "Any Subregion");
				if (p.roomName === "gw_c11")
					r += " underground";
				if (p.roomName === "gw_c05")
					r += " surface";
				d = "Throw a grenade at the " + r + " Scavenger toll" + (p.pass ? ", then pass it." : ".");
			} else {
				if (p.amount <= 1)
					d = "Throw a grenade at a Scavenger toll";
				else
					d = "Throw grenades at " + String(p.amount) + " Scavenger tolls";
				d += (p.pass ? ", then pass them." : ".");
			}
			return d;
		}
		function BombTollChallengeToBinary(p) {
			var b = Array(4); b.fill(0);
			if (p.specific === "true") {
				//	can use old version
				b[0] = challengeValue("BingoBombTollChallenge");
				applyBool(b, 1, 4, String(p.pass));
				b[3] = enumToValue(p.roomName, "tolls");
				b[2] = b.length - GOAL_LENGTH;
			} else {
				//	new format
				b = Array(5); b.fill(0);
				b[0] = challengeValue("BingoBombTollExChallenge");
				applyBool(b, 1, 4, String(p.pass));
				applyBool(b, 1, 5, String(p.specific));
				b[3] = enumToValue(p.roomName, "tolls");
				b[4] = p.amount;
				for (var k = 0; k < p.bombed.length; k++) {
					b.push(BingoEnum_BombedDict.indexOf(p.bombed[k]));
				}
				b[2] = b.length - GOAL_LENGTH;
			}
			return new Uint8Array(b);
		}
		var v = [], i = [];
		v.push(String(params.specific)); i.push("specific");
		v.push(String(params.roomName)); i.push("roomName");
		v.push(String(params.pass));     i.push("pass");
		v.push(String(params.current));  i.push("current");
		v.push(String(params.amount));   i.push("amount");
		v.push(String(params.bombed.join(params._templates.bombed.separator))); i.push("bombed");
		return {
			name: thisname,
			params: params,
			category: "Throwing grenades at Scavenger tolls",
			items: i,
			values: v,
			description: BombTollChallengeToDescription(params),
			comments: BombTollChallengeToComments(params),
			paint: BombTollChallengeToPaint(params),
			toBin: BombTollChallengeToBinary(params)
		};
	},
	BingoCollectPearlChallenge: function(desc, board) {
		const thisname = "BingoCollectPearlChallenge";
		//	desc of format ["System.Boolean|true|Specific Pearl|0|NULL", "System.String|LF_bottom|Pearl|1|pearls", "0", "System.Int32|1|Amount|3|NULL", "0", "0", ""]
		checkDescLen(thisname, desc.length, 7);
		var speci = checkSettingBox(thisname, desc[0], ["System.Boolean", , "Specific Pearl", , "NULL"], "specific pearl flag");
		if (speci[1] !== "true" && speci[1] !== "false")
			throw new TypeError(thisname + ": starving flag \"" + speci[1] + "\" not 'true' or 'false'");
		var items = checkSettingBox(thisname, desc[1], ["System.String", , "Pearl", , "pearls"], "pearl selection");
		if (!DataPearlList.includes(items[1])) {
			throw new TypeError(thisname + ": item \"" + items[1] + "\" not found in DataPearlList[]");
		}
		if (dataPearlToDisplayTextMap[items[1]] === undefined)
			throw new TypeError(thisname + ": item \"" + items[1] + "\" not found in dataPearlToDisplayTextMap[]");
		var amounts = checkSettingBox(thisname, desc[3], ["System.Int32", , "Amount", , "NULL"], "amount selection");
		var amt = parseInt(amounts[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + amounts[1] + "\" not a number or out of range");
		var d, p;
		if (speci[1] === "true") {
			var r = "";
			if (items[1] === "MS")
				r = "Old " + regionCodeToDisplayName["GW"];
			else {
				var regi = dataPearlToRegionMap[items[1]];
				if (regi === undefined)
					throw new TypeError(thisname + ": item \"" + items[1] + "\" not found in pearls");
				if (items[1] === "DM") {
					//	Special case: DM pearl is found in DM only for Spearmaster; it's MS any other time
					if (Object.values(BingoEnum_CharToDisplayText).indexOf(board.character) < 0
							|| board.character === "Nightcat" || board.character === "Any")
						r = regionCodeToDisplayName["DM"] + " / " + regionCodeToDisplayName["MS"];
					else if (board.character === "Spearmaster")
						r = regionCodeToDisplayName["DM"];
					else
						r = regionCodeToDisplayName["MS"];
				} else {
					r = regionToDisplayText(board.character, regi, "Any Subregion");
				}
			}
			d = "Collect the " + dataPearlToDisplayTextMap[items[1]] + " pearl from " + r + ".";
			p = [
				{ type: "text", value: items[1], color: RainWorldColors.Unity_white },
				{ type: "break" },
				{ type: "icon", value: "Symbol_Pearl", scale: 1, color: dataPearlToColorMap[items[1]], rotation: 0, background:
					{ type: "icon", value: "radialgradient", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 }
				},
				{ type: "break" },
				{ type: "text", value: "[0/1]", color: RainWorldColors.Unity_white }
			];
		} else {
			d = "Collect " + entityNameQuantify(amt, "colored pearls") + ".";
			p = [
				{ type: "icon", value: "pearlhoard_color", scale: 1, color: entityIconColor("Pearl"), rotation: 0 },
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
	BingoCraftChallenge: function(desc, board) {
		const thisname = "BingoCraftChallenge";
		//	desc of format ["System.String|JellyFish|Item to Craft|0|craft", "System.Int32|5|Amount|1|NULL", "0", "0", "0"]
		checkDescLen(thisname, desc.length, 5);
		var items = checkSettingBox(thisname, desc[0], ["System.String", , "Item to Craft", , "craft"], "item selection");
		if (!BingoEnum_CraftableItems.includes(items[1])) {
			throw new TypeError(thisname + ": \"" + items[1] + "\" not found in craft");
		}
		var d = entityDisplayText(items[1]);
		var amounts = checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "amount selection");
		var amt = parseInt(amounts[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + amounts[1] + "\" not a number or out of range");
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
			description: "Craft " + entityNameQuantify(amt, d) + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "crafticon", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: entityIconAtlas(items[1]), scale: 1, color: entityIconColor(items[1]), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoCreatureGateChallenge: function(desc, board) {
		const thisname = "BingoCreatureGateChallenge";
		//	desc of format ["System.String|CicadaA|Creature Type|1|transport", "0", "System.Int32|4|Amount|0|NULL", "empty", "0", "0"]
		checkDescLen(thisname, desc.length, 6);
		var items = checkSettingBox(thisname, desc[0], ["System.String", , "Creature Type", , "transport"], "creature selection");
		if (creatureNameToDisplayTextMap[items[1]] === undefined)
			throw new TypeError(thisname + ": \"" + items[1] + "\" not found in creatures");
		var amounts = checkSettingBox(thisname, desc[2], ["System.Int32", , "Amount", , "NULL"], "amount selection");
		var amt = parseInt(amounts[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + amounts[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		if (BingoEnum_Transportable.includes(items[1]))
			b[3] = enumToValue(items[1], "transport");
		else
			b[3] = enumToValue(items[1], "creatures") + BINARY_TO_STRING_DEFINITIONS[challengeValue(thisname)].params[0].altthreshold - 1;
		b[4] = amt;
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Transporting the same creature through gates",
			items: [items[2], amounts[2], "Dictionary"],
			values: [items[1], amounts[1], desc[3]],
			description: "Transport " + entityNameQuantify(1, entityDisplayText(items[1])) + " through " + String(amt) + " gate" + ((amt > 1) ? "s." : "."),
			comments: "When a creature is taken through a gate, that creature is added to a list and the gate is logged. If a gate already appears in the creature's list, taking that gate again will not advance the count. Thus, you can't grind progress by taking one gate back and forth. The list is stored per creature transported; thus, taking a new different creature does not advance the count, nor does piling multiple creatures into one gate. When the total gate count of any logged creature reaches the goal, credit is awarded.",
			paint: [
				{ type: "icon", value: entityIconAtlas(items[1]), scale: 1, color: entityIconColor(items[1]), rotation: 0 },
				{ type: "icon", value: "singlearrow", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "ShortcutGate", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoCycleScoreChallenge: function(desc, board) {
		const thisname = "BingoCycleScoreChallenge";
		//	desc of format ["System.Int32|126|Target Score|0|NULL", "0", "0"]
		checkDescLen(thisname, desc.length, 3);
		var items = checkSettingBox(thisname, desc[0], ["System.Int32", , "Target Score", , "NULL"], "score goal");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
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
	BingoDamageChallenge: function(desc, board) {
		const thisname = "BingoDamageChallenge";
		//	desc of format (< v1.091) ["System.String|JellyFish|Weapon|0|weapons", "System.String|WhiteLizard|Creature Type|1|creatures", "0", "System.Int32|6|Amount|2|NULL", "0", "0"]
		//	or (>= v1.091) ["System.String|JellyFish|Weapon|0|weapons", "System.String|AquaCenti|Creature Type|1|creatures", "0", "System.Int32|5|Amount|2|NULL", "System.Boolean|false|In One Cycle|0|NULL", "System.String|Any Region|Region|5|regions", "System.String|Any Subregion|Subregion|4|subregions", "0", "0"]
		//	or (>= v1.2) ["System.String|JellyFish|Weapon|0|weapons", "System.String|PinkLizard|Creature Type|1|creatures", "0", "System.Int32|3|Amount|2|NULL", "System.Boolean|false|In One Cycle|3|NULL", "System.String|Any Region|Region|5|regions", "0", "0"]
		const upgrades = {
			6: [ {	//	v1.091 hack: allow 6 or 9 parameters; assume the existing parameters are ordered as expected
				op: "splice", offs: 4, rem: 0, data: ["System.Boolean|false|In One Cycle|0|NULL", "System.String|Any Region|Region|5|regions", "System.String|Any Subregion|Subregion|5|subregions"]
			} ],
			8: [ {	//	>= v1.2: Subregion removed; add back in dummy value for compatibility
				op: "splice", offs: 6, rem: 0, data: ["System.String|Any Subregion|Subregion|5|subregions"]
			} ],
			9: [ {	//	Bingovista-native format; one typo cleanup, then return the .length = 9
				op: "replace", offs: 6, find: "Journey\\'s End", replace: "Journey's End"
			} ]
		};
		desc = upgradeDescriptor(desc, upgrades);
		const template = [
			{ param: "weapon",  type: "string", formatter: "weapons", parse: "SettingBox", parseFmt: { datatype: "System.String", name: "Weapon", position: "0", formatter: "weapons", altformatter: "", altthreshold: 0, defaultval: "Any Weapon" } },
			{ param: "victim",  type: "string", formatter: "creatures", parse: "SettingBox", parseFmt: { datatype: "System.String", name: "Creature Type", position: "1", formatter: "creatures", altformatter: "", altthreshold: 0, defaultval: "Any Creature" } },
			{ param: "current", type: "number", formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0 },
			{ param: "amount",  type: "number", formatter: "", parse: "SettingBox", parseFmt: { datatype: "System.Int32", name: "Amount", position: "2", formatter: "NULL", minval: 0, maxval: INT_MAX, defaultval: 1 } },
			{ param: "onecycle",  type: "bool", formatter: "", parse: "SettingBox", parseFmt: { datatype: "System.Boolean", name: "In One Cycle", position: "3", formatter: "NULL", defaultval: false } },
			{ param: "region",  type: "string", formatter: "regions", parse: "SettingBox", parseFmt: { datatype: "System.String", name: "Region", position: "5", formatter: "regions", defaultval: "Any Region" } },
			{ param: "subregion",  type: "string", formatter: "subregions", parse: "SettingBox", parseFmt: { datatype: "System.String", name: "Subregion", position: "4", formatter: "subregions", defaultval: "Any Subregion" } },
			{ param: "completed", type: "number", formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0 },
			{ param: "revealed",  type: "number", formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0 }
		];
		var params = challengeTextToAbstract(desc, template);
		params._name = thisname;
		params._board = board;
		function DamageChallengePaint(p) {
			var r = [];
			if (p.weapon !== "Any Weapon") {
				r.push( { type: "icon", value: entityIconAtlas(p.weapon), scale: 1, color: entityIconColor(p.weapon), rotation: 0 } );
			}
			r.push( { type: "icon", value: "bingoimpact", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
			if (p.victim !== "Any Creature") {
				r.push( { type: "icon", value: entityIconAtlas(p.victim), scale: 1, color: entityIconColor(p.victim), rotation: 0 } );
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
			r.push( { type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: RainWorldColors.Unity_white } );
			if (p.onecycle)
				r.push( { type: "icon", value: "cycle_limit", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
			return r;
		}
		function DamageChallengeDescription(p) {
			var r = regionToDisplayText(p._board.character, p.region, p.subregion);
			if (r > "") r = ", in " + r;
			var d = "Hit " + entityDisplayText(p.victim) + " with " + entityDisplayText(p.weapon);
			d += " " + String(p.amount) + ((p.amount > 1) ? " times" : " time") + r;
			if (p.onecycle) d += ", in one cycle";
			d += ".";
			return d;
		}
		function DamageChallengeToBinary(p) {
			//	start with classic format...
			var b = Array(7); b.fill(0);
			b[0] = challengeValue(thisname);
			b[3] = enumToValue(p.weapon, "weapons");
			b[4] = enumToValue(p.victim, "creatures");
			applyShort(b, 5, p.amount);
			if (p.onecycle || p.region !== "Any Region" || p.subregion !== "Any Subregion") {
				//	...have to use expanded form
				b[0] = challengeValue("BingoDamageExChallenge");
				applyBool(b, 1, 4, String(p.onecycle));
				b.push(enumToValue(p.region, "regions"));
				b.push(enumToValue(p.subregion, "subregions"));
			}
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
		var v = [], i = [];
		v.push(String(params.weapon));    i.push("weapon");
		v.push(String(params.victim));    i.push("victim");
		v.push(String(params.current));   i.push("current");
		v.push(String(params.amount));    i.push("amount");
		v.push(String(params.onecycle));  i.push("onecycle");
		v.push(String(params.region));    i.push("region");
		v.push(String(params.subregion)); i.push("subregion");
		return {
			name: thisname,
			params: params,
			category: "Hitting creatures with items",
			items: i,
			values: v,
			description: DamageChallengeDescription(params),
			comments: "Note: the reskinned BLLs in the Past Garbage Wastes tunnel <em>do not count</em> as DLLs for this challenge.<br>" +
					"Note: <span class=\"code\">Subregion</span> was never fully implemented, and is deprecated in v1.2+. Bingovista displays this parameter only for completeness.",
			paint: DamageChallengePaint(params),
			toBin: DamageChallengeToBinary(params)
		};
	},
	BingoDepthsChallenge: function(desc, board) {
		const thisname = "BingoDepthsChallenge";
		//	desc of format ["System.String|VultureGrub|Creature Type|0|depths", "0", "0"]
		checkDescLen(thisname, desc.length, 3);
		var items = checkSettingBox(thisname, desc[0], ["System.String", , "Creature Type", , "depths"], "creature selection");
		if (BingoEnum_Depthable[items[1]] === undefined && creatureNameToDisplayTextMap[items[1]] === undefined)
			throw new TypeError(thisname + ": \"" + items[1] + "\" not found in creatures");
		d = entityNameQuantify(1, entityDisplayText(items[1]));
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		if (BingoEnum_Transportable.includes(items[1]))
			b[3] = enumToValue(items[1], "depths");
		else
			b[3] = enumToValue(items[1], "creatures") + BINARY_TO_STRING_DEFINITIONS[challengeValue(thisname)].params[0].altthreshold - 1;
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Dropping a creature in the depth pit",
			items: [items[2]],
			values: [items[1]],
			description: "Drop " + d + " into the Depths drop room (SB_D06).",
			comments: "Player, and creature of target type, must be in the room at the same time, and the creature's position must be below the drop." + getMapLink("SB_D06", board.character),
			paint: [
				{ type: "icon", value: entityIconAtlas(items[1]), scale: 1, color: entityIconColor(items[1]), rotation: 0 },
				{ type: "icon", value: "deathpiticon", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "SB_D06", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoDodgeLeviathanChallenge: function(desc, board) {
		const thisname = "BingoDodgeLeviathanChallenge";
		//	desc of format ["0", "0"]
		checkDescLen(thisname, desc.length, 2);
		var b = Array(3); b.fill(0);
		b[0] = challengeValue(thisname);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Dodging a Leviathan",
			items: [],
			values: [],
			description: "Dodge a Leviathan's bite.",
			comments: "Being in close proximity to a Leviathan, as it's winding up a bite, will activate this goal. (A more direct/literal interpretation&mdash;having to have been physically inside its maw, then surviving after it slams shut&mdash;was found... too challenging by playtesters.)",
			paint: [
				{ type: "icon", value: "leviathan_dodge", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoDontUseItemChallenge: function(desc, board) {
		const thisname = "BingoDontUseItemChallenge";
		//	desc of format ["System.String|BubbleGrass|Item type|0|banitem", "0", "0", "0", "0"]
		checkDescLen(thisname, desc.length, 5);
		var items = checkSettingBox(thisname, desc[0], ["System.String", , "Item type", , "banitem"], "item selection");
		if (!ALL_ENUMS.banitem.includes(items[1])) {
			throw new TypeError(thisname + ": \"" + items[1] + "\" not found in banitem");
		}
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
			description: "Never " + ((desc[1] === "1") ? "eat" : "use") + " " + entityDisplayText(items[1]) + ".",
			comments: "\"Using\" an item involves throwing a throwable item, eating a food item, or holding any other type of item for 5 seconds. (When sheltering with insufficient food pips (currently eaten), food items in the shelter are consumed automatically. Auto-eating on shelter <em>will not</em> count against this goal!)",
			paint: [
				{ type: "icon", value: "buttonCrossA", scale: 1, color: RainWorldColors.Unity_red, rotation: 0 },
				{ type: "icon", value: entityIconAtlas(items[1]), scale: 1, color: entityIconColor(items[1]), rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoEatChallenge: function(desc, board) {
		const thisname = "BingoEatChallenge";
		//	desc of format (< v1.2) ["System.Int32|6|Amount|1|NULL", "0", "0", "System.String|DangleFruit|Food type|0|food", "0", "0"]
		//	or (>= v1.2) ["System.Int32|4|Amount|3|NULL", "0", "0", "System.String|SlimeMold|Food type|0|food", "System.Boolean|false|While Starving|2|NULL", "0", "0"]
		if (desc.length == 6) {
			desc.splice(4, 0, "System.Boolean|false|While Starving|2|NULL");
		}
		checkDescLen(thisname, desc.length, 7);
		var amounts = checkSettingBox(thisname, desc[0], ["System.Int32", , "Amount", , "NULL"], "eat amount");
		var amt = parseInt(amounts[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + amounts[1] + "\" not a number or out of range");
		var isCrit = parseInt(desc[2]);
		if (isNaN(isCrit) || isCrit < 0 || isCrit > 1)
			throw new TypeError(thisname + ": isCreature \"" + desc[2] + "\" not a number or out of range");
		isCrit = (isCrit == 1) ? "true" : "false";
		var items = checkSettingBox(thisname, desc[3], ["System.String", , "Food type", , "food"], "eat type");
		if (!BingoEnum_FoodTypes.includes(items[1]))
			throw new TypeError(thisname + ": \"" + items[1] + "\" not found in food");
		var starv = checkSettingBox(thisname, desc[4], ["System.Boolean", , "While Starving", , "NULL"], "starving flag");
		if (starv[1] !== "true" && starv[1] !== "false")
			throw new TypeError(thisname + ": flag \"" + starv[1] + "\" not 'true' or 'false'");
		var p = [
			{ type: "icon", value: "foodSymbol", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
			{ type: "icon", value: entityIconAtlas(items[1]), scale: 1, color: entityIconColor(items[1]), rotation: 0 },
			{ type: "break" },
			{ type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white }
		];
		if (starv[1] === "true")
			p.splice(2, 0, { type: "break" }, { type: "icon", value: "Multiplayer_Death", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
		var b = Array(6); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		applyBool(b, 1, 4, String(desc[2] === "1"));
		applyBool(b, 1, 5, String(starv[1] === "true"));
		b[5] = enumToValue(items[1], "food");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Eating specific food",
			items: [amounts[2], "isCreature", items[2], starv[2]],
			values: [String(amt), isCrit, items[1], starv[1]],
			description: "Eat " + entityNameQuantify(amt, entityDisplayText(items[1])) + ((starv[1] === "true") ? ", while starving." : "."),
			comments: "",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoEchoChallenge: function(desc, board) {
		const thisname = "BingoEchoChallenge";
		//	desc of format (< v1.2) ["System.String|SB|Region|0|echoes", "System.Boolean|false|While Starving|1|NULL", "0", "0"]
		//	or (>= v1.2) ["System.Boolean|false|Specific Echo|0|NULL", "System.String|SB|Region|1|echoes", "System.Boolean|true|While Starving|3|NULL", "0", "System.Int32|2|Amount|2|NULL", "0", "0", ""]
		if (desc.length == 4) {
			desc.unshift("System.Boolean|true|Specific Echo|0|NULL");
			desc.splice(3, 0, "0", "System.Int32|1|Amount|2|NULL");
			desc.push("");
		}
		checkDescLen(thisname, desc.length, 8);
		var speci = checkSettingBox(thisname, desc[0], ["System.Boolean", , "Specific Echo", , "NULL"], "specific flag");
		if (speci[1] !== "true" && speci[1] !== "false")
			throw new TypeError(thisname + ": specific flag \"" + speci[1] + "\" not 'true' or 'false'");
		var echor = checkSettingBox(thisname, desc[1], ["System.String", , "Region", , "echoes"], "echo region");
		if (BingoEnum_AllRegionCodes.indexOf(echor[1]) < 0)
			throw new TypeError(thisname + ": \"" + echor[1] + "\" not found in regions");
		var r = regionToDisplayText(board.character, echor[1], "Any Subregion");
		var starv = checkSettingBox(thisname, desc[2], ["System.Boolean", , "While Starving", , "NULL"], "starving flag");
		if (starv[1] !== "true" && starv[1] !== "false")
			throw new TypeError(thisname + ": starving flag \"" + starv[1] + "\" not 'true' or 'false'");
		var amount = checkSettingBox(thisname, desc[4], ["System.Int32", , "Amount", , "NULL"], "echo amount");
		var amt = parseInt(amount[1]);
		amt = Math.min(amt, CHAR_MAX);
		if (isNaN(amt) || amt < 1)
			throw new TypeError(thisname + ": amount \"" + amount[1] + "\" not a number or out of range");
		var visited = [];
		if (desc[7] > "") {
			desc[7].split("|");
			for (var k = 0; k < visited.length; k++) {
				if (BingoEnum_AllRegionCodes[visited[k]] === undefined)
					throw new TypeError(thisname + ": visited \"" + visited[k] + "\" not found in regions");
			}
		}
		var p = [
			{ type: "icon", value: "echo_icon", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
			{ type: "text", value: ((speci[1] === "true") ? echor[1] : "[0/" + amt + "]"), color: RainWorldColors.Unity_white }
		];
		if (starv[1] === "true") {
			p.push( { type: "break" } );
			p.push( { type: "icon", value: "Multiplayer_Death", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
		}
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		applyBool(b, 1, 4, starv[1]);
		b[3] = enumToValue(echor[1], "echoes");
		b[2] = b.length - GOAL_LENGTH;
		if (speci[1] === "false") {
			b[0] = challengeValue("BingoEchoExChallenge");
			b.push(amt);
			visited.forEach(v => b.push(enumToValue(v, "regions")));
		}
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Visiting echoes",
			items: [speci[2], echor[2], starv[2], amount[2], "visited"],
			values: [speci[1], echor[1], starv[1], String(amt), desc[7]],
			description: "Visit " + ((speci[1] === "false") ? (String(amt) + " Echoes") : ("the " + r + " Echo")) + ((starv[1] === "true") ? ", while starving." : "."),
			comments: "The \"visited\" list records the state of the multi-echo version. It is a <span class=\"code\">|</span>-separated list of region codes. A region is added to the list when its echo has been visited. By preloading this list, a customized \"all but these echoes\" challenge could be crafted (but, do note the list does not show in-game!).",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoEnterRegionChallenge: function(desc, board) {
		const thisname = "BingoEnterRegionChallenge";
		//	desc of format ["System.String|CC|Region|0|regionsreal", "0", "0"]
		checkDescLen(thisname, desc.length, 3);
		var items = checkSettingBox(thisname, desc[0], ["System.String", , "Region", , "regionsreal"], "enter region");
		if (BingoEnum_AllRegionCodes.indexOf(items[1]) < 0)
			throw new TypeError(thisname + ": region \"" + items[1] + "\" not found in regions");
		var r = regionToDisplayText(board.character, items[1], "Any Subregion");
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
	BingoGlobalScoreChallenge: function(desc, board) {
		const thisname = "BingoGlobalScoreChallenge";
		//	desc of format ["0", "System.Int32|271|Target Score|0|NULL", "0", "0"]
		checkDescLen(thisname, desc.length, 4);
		var items = checkSettingBox(thisname, desc[1], ["System.Int32", , "Target Score", , "NULL"], "score goal");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
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
	BingoGreenNeuronChallenge: function(desc, board) {
		const thisname = "BingoGreenNeuronChallenge";
		//	desc of format ["System.Boolean|true|Looks to the Moon|0|NULL", "0", "0"]
		checkDescLen(thisname, desc.length, 3);
		var items = checkSettingBox(thisname, desc[0], ["System.Boolean", , "Looks to the Moon", , "NULL"], "iterator choice flag");
		if (items[1] !== "true" && items[1] !== "false")
			throw new TypeError(thisname + ": flag \"" + items[1] + "\" not 'true' or 'false'");
		var d = "Deliver the green neuron to ";
		if (items[1] === "true") d = "Reactivate ";
		d += iteratorNameToDisplayTextMap[items[1]] + ".";
		var p = [
			{ type: "icon", value: "GuidanceNeuron", scale: 1, color: RainWorldColors.GuidanceNeuron, rotation: 0 },
			{ type: "icon", value: "singlearrow", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
		]
		p.push( { type: "icon", value: iteratorNameToIconAtlasMap[items[1]], scale: 1, color: iteratorNameToIconColorMap[items[1]], rotation: 0 } );
		var b = Array(3); b.fill(0);
		b[0] = challengeValue(thisname);
		applyBool(b, 1, 4, items[1]);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Delivering the Green Neuron",
			items: [items[2]],
			values: [items[1]],
			description: d,
			comments: "The green neuron only has to enter the screen the iterator is on and start the cutscene; waiting for full dialog/startup is not required for credit.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoHatchNoodleChallenge: function(desc, board) {
		const thisname = "BingoHatchNoodleChallenge";
		//	desc of format ["0", "System.Int32|3|Amount|1|NULL", "System.Boolean|true|At Once|0|NULL", "0", "0"]
		checkDescLen(thisname, desc.length, 5);
		var amounts = checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "egg count");
		var amt = parseInt(amounts[1]);
		amt = Math.min(amt, CHAR_MAX);
		if (isNaN(amt) || amt < 1)
			throw new TypeError(thisname + ": amount \"" + amounts[1] + "\" not a number or out of range");
		var items = checkSettingBox(thisname, desc[2], ["System.Boolean", , "At Once", , "NULL"], "one-cycle flag");
		if (items[1] !== "true" && items[1] !== "false")
			throw new TypeError(thisname + ": flag \"" + items[1] + "\" not 'true' or 'false'");
		var p = [
			{ type: "icon", value: entityIconAtlas("NeedleEgg"), scale: 1, color: entityIconColor("NeedleEgg"), rotation: 0 },
			{ type: "icon", value: entityIconAtlas("SmallNeedleWorm"), scale: 1, color: entityIconColor("SmallNeedleWorm"), rotation: 0 },
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
			description: "Hatch " + entityNameQuantify(amt, entityDisplayText("NeedleEgg")) + ((items[1] === "true") ? " in one cycle." : "."),
			comments: "Eggs must be hatched where the player is sheltering. Eggs stored in other shelters disappear and do not give credit towards this goal.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoHellChallenge: function(desc, board) {
		const thisname = "BingoHellChallenge";
		//	desc of format ["0", "System.Int32|2|Amount|0|NULL", "0", "0"]
		checkDescLen(thisname, desc.length, 4);
		var items = checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "goal count");
		var amt = parseInt(items[1]);
		amt = Math.min(amt, CHAR_MAX);
		if (isNaN(amt) || amt < 1)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
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
	BingoItemHoardChallenge: function(desc, board) {
		const thisname = "BingoItemHoardChallenge";
		//	desc of format (< v1.092) ["System.Int32|5|Amount|1|NULL", "System.String|PuffBall|Item|0|expobject", "0", "0"]
		//	or (>= 1.092) ["System.Boolean|true|Any Shelter|2|NULL", "0", "System.Int32|4|Amount|0|NULL", "System.String|DangleFruit|Item|1|expobject", "0", "0", ""]
		//	or (>= 1.2) ["System.Boolean|true|Any Shelter|2|NULL", "0", "System.Int32|4|Amount|0|NULL", "System.String|Mushroom|Item|1|expobject", "System.String|VS|Region|4|regions", "0", "0", ""]
		//	anyShelter, current, amount, item, region, completed, revealed, collected
		if (desc.length == 4) {
			//	1.092 hack: allow 4 or 7 parameters; assume the existing parameters are ordered as expected
			desc.unshift("System.Boolean|false|Any Shelter|2|NULL", "0");
			desc.push("");
		}
		if (desc.length == 7) {
			//	1.2 hack: allow 4, 7 or 8 parameters
			desc.splice(4, 0, "System.String|Any Region|Region|4|regions");
		}
		checkDescLen(thisname, desc.length, 8);
		var any = checkSettingBox(thisname, desc[0], ["System.Boolean", , "Any Shelter", , "NULL"], "any shelter flag");
		var amounts = checkSettingBox(thisname, desc[2], ["System.Int32", , "Amount", , "NULL"], "item count");
		var items = checkSettingBox(thisname, desc[3], ["System.String", , "Item", , "expobject"], "item selection");
		var reg = checkSettingBox(thisname, desc[4], ["System.String", , "Region", , "regions"], "region");
		if (!BingoEnum_expobject.includes(items[1]))
			throw new TypeError(thisname + ": \"" + items[1] + "\" not found in expobject");
		var amt = parseInt(amounts[1]);
		amt = Math.min(amt, CHAR_MAX);
		if (isNaN(amt) || amt < 1)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
		if (any[1] !== "true" && any[1] !== "false")
			throw new TypeError(thisname + ": shelter flag \"" + any[1] + "\" not 'true' or 'false'");
		if (reg[1] !== "Any Region") {
			if (BingoEnum_AllRegionCodes.indexOf(reg[1]) < 0)
				throw new TypeError(thisname + ": \"" + reg[1] + "\" not found in regions");
		}
		var r = regionToDisplayText(board.character, reg[1], "Any Subregion") + ".";
		if (r.length > 1) r = ", in " + r;
		var d = "";
		d += (any[1] === "true") ? "Bring " : "Hoard ";
		d += entityNameQuantify(amt, entityDisplayText(items[1]));
		d += (any[1] === "true") ? " to " : " in ";
		if (amt == 1)
			d += "a shelter";
		else if (any[1] === "true")
			d += "any shelters";
		else
			d += "the same shelter";
		d += r;
		var p = [ { type: "icon", value: entityIconAtlas(items[1]), scale: 1, color: entityIconColor(items[1]), rotation: 0 } ];
		if (any[1] === "true") {
			p.push( { type: "icon", value: "singlearrow", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
					{ type: "icon", value: "doubleshelter", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
		} else {
			p.unshift( { type: "icon", value: "ShelterMarker", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
		}
		p.push( { type: "break" },
				{ type: "text", value: "[0/" + amt + "]", color: RainWorldColors.Unity_white } );
		if (reg[1] !== "Any Region") {
			p.splice(p.length - 2, 0, { type: "break" }, { type: "text", value: reg[1], color: RainWorldColors.Unity_white } );
		}
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyBool(b, 1, 4, any[1]);
		b[3] = amt;
		b[4] = enumToValue(items[1], "expobject");
		if (reg[1] !== "Any Region") {
			b[0] = challengeValue("BingoItemHoardExChallenge");
			b.push(enumToValue(reg[1], "regions"));
		}
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Hoarding items in shelters",
			items: [amounts[2], items[2], reg[2]],
			values: [String(amt), items[1], reg[1]],
			description: d,
			comments: "The 'a shelter' option behaves as the base Expedition goal; count is updated on shelter close.<br>" +
					"The 'Any Shelter' option counts the total across any shelters in the world. Counts are per item ID, updated when the item is brought into a shelter. Counts never go down, so items are free to use after \"hoarding\" them, including eating or removing. Because items are tracked by ID, this goal cannot be cheesed by taking the same items between multiple shelters; multiple unique items must be hoarded. In short, it's the act of hoarding (putting a new item in a shelter) that counts up.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoKarmaFlowerChallenge: function(desc, board) {
		const thisname = "BingoKarmaFlowerChallenge";
		//	assert: desc of format ["0", "System.Int32|5|Amount|0|NULL", "0", "0"]
		checkDescLen(thisname, desc.length, 4);
		var items = checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "item count");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Consuming Karma Flowers",
			items: [items[2]],
			values: [String(amt)],
			description: "Consume " + entityNameQuantify(amt, "Karma Flowers") + ".",
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
	BingoKillChallenge: function(desc, board) {
		const thisname = "BingoKillChallenge";
		//	assert: desc of format (< v1.2) ["System.String|Scavenger|Creature Type|0|creatures", "System.String|Any Weapon|Weapon Used|6|weaponsnojelly", "System.Int32|5|Amount|1|NULL", "0", "System.String|Any Region|Region|5|regions", "System.String|Any Subregion|Subregion|4|subregions", "System.Boolean|false|In one Cycle|3|NULL", "System.Boolean|false|Via a Death Pit|7|NULL", "System.Boolean|false|While Starving|2|NULL", "0", "0"]
		//	or (>= v1.2) [System.String|TentaclePlant|Creature Type|0|creatures", "System.String|Any Weapon|Weapon Used|6|weaponsnojelly", "System.Int32|4|Amount|1|NULL", "0", "System.String|Any Region|Region|5|regions", "System.Boolean|false|In one Cycle|3|NULL", "System.Boolean|false|Via a Death Pit|7|NULL", "System.Boolean|false|While Starving|2|NULL", "System.Boolean|false|While under mushroom effect|8|NULL", "0", "0"]
		if (desc[8] && desc[8].search("mushroom") < 0) {
			//	< v1.2: contains subregion, no mushroom
			desc.splice(9, 0, "System.Boolean|false|While under mushroom effect|8|NULL");
		} else {
			//	>= v1.2: Subregion removed; add back in dummy value for compatibility
			desc.splice(5, 0, "System.String|Any Subregion|Subregion|4|subregions");
		}
		//	now is superset: contains subregion *and* mushroom; length 12
		checkDescLen(thisname, desc.length, 12);
		var v = [], i = [];
		var items = checkSettingBox(thisname, desc[0], ["System.String", , "Creature Type", , "creatures"], "target selection"); v.push(items[1]); i.push(items[2]);
		items = checkSettingBox(thisname, desc[1], ["System.String", , "Weapon Used", , "weaponsnojelly"], "weapon selection"); v.push(items[1]); i.push(items[2]);
		items = checkSettingBox(thisname, desc[2], ["System.Int32", , "Amount", , "NULL"], "kill count"); v.push(items[1]); i.push(items[2]);
		items = checkSettingBox(thisname, desc[4], ["System.String", , "Region", , "regions"], "region selection"); v.push(items[1]); i.push(items[2]);
		items = checkSettingBox(thisname, desc[5], ["System.String", , "Subregion", , "subregions"], "subregion selection"); v.push(items[1]); i.push(items[2]);
		items = checkSettingBox(thisname, desc[6], ["System.Boolean", , "In one Cycle", , "NULL"], "one-cycle flag"); v.push(items[1]); i.push(items[2]);
		items = checkSettingBox(thisname, desc[7], ["System.Boolean", , "Via a Death Pit", , "NULL"], "death pit flag"); v.push(items[1]); i.push(items[2]);
		items = checkSettingBox(thisname, desc[8], ["System.Boolean", , "While Starving", , "NULL"], "starving flag"); v.push(items[1]); i.push(items[2]);
		items = checkSettingBox(thisname, desc[9], ["System.Boolean", , "While under mushroom effect", , "NULL"], "mushroom flag"); v.push(items[1]); i.push(items[2]);
		var r = "";
		var amt = parseInt(v[2]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + v[2] + "\" not a number or out of range");
		var c = entityNameQuantify(amt, "creatures");
		if (v[0] !== "Any Creature") {
			if (creatureNameToDisplayTextMap[v[0]] === undefined)
				throw new TypeError(thisname + ": \"" + v[0] + "\" not found in creatures");
			c = entityNameQuantify(amt, entityDisplayText(v[0]));
		}
		if (v[3] !== "Any Region") {
			if (BingoEnum_AllRegionCodes.indexOf(v[3]) < 0)
				throw new TypeError(thisname + ": \"" + v[3] + "\" not found in regions");
		}
		if (v[4] !== "Any Subregion") {
			if (v[4] === "Journey\\'s End") v[4] = "Journey\'s End";
			if (BingoEnum_AllSubregions.indexOf(v[4]) == -1)
				throw new TypeError(thisname + ": \"" + v[4] + "\" not found in subregions");
		}
		var r = regionToDisplayText(board.character, v[3], v[4]);
		if (r > "") r = " in " + r;
		var w = ", with a death pit";
		if (!BingoEnum_Weapons.includes(v[1]))
			throw new TypeError(thisname + ": \"" + v[1] + "\" not found in weapons");
		if (v[6] === "false") {
			if (v[1] !== "Any Weapon") {
				w = " with " + entityDisplayText(v[1]);
			} else {
				w = "";
			}
		}
		var p = [];
		if (v[1] !== "Any Weapon" || v[6] === "true") {
			if (v[6] === "true")
				p.push( { type: "icon", value: "deathpiticon", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
			else
				p.push( { type: "icon", value: entityIconAtlas(v[1]), scale: 1, color: entityIconColor(v[1]), rotation: 0 } );
		}
		if (v[5] !== "true" && v[5] !== "false")
			throw new TypeError(thisname + ": one-cycle flag \"" + v[5] + "\" not 'true' or 'false'");
		if (v[6] !== "true" && v[6] !== "false")
			throw new TypeError(thisname + ": death pit flag \"" + v[6] + "\" not 'true' or 'false'");
		if (v[7] !== "true" && v[7] !== "false")
			throw new TypeError(thisname + ": starving flag \"" + v[7] + "\" not 'true' or 'false'");
		if (v[8] !== "true" && v[8] !== "false")
			throw new TypeError(thisname + ": mushroom flag \"" + v[8] + "\" not 'true' or 'false'");
		p.push( { type: "icon", value: "Multiplayer_Bones", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
		if (v[0] !== "Any Creature") {
			p.push( { type: "icon", value: entityIconAtlas(v[0]), scale: 1, color: entityIconColor(v[0]), rotation: 0 } );
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
		if (v[8] === "true")
			p.push( { type: "icon", value: entityIconAtlas("Mushroom"), scale: 1, color: entityIconColor("Mushroom"), rotation: 0 } );
		var b = Array(9); b.fill(0);
		b[0] = challengeValue(thisname);
		applyBool(b, 1, 4, v[5]);
		applyBool(b, 1, 5, v[6]);
		applyBool(b, 1, 6, v[7]);
		applyBool(b, 1, 7, v[8]);
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
					+ ((v[5] === "true") ? ", in one cycle" : "")
					+ ((v[8] === "true") ? ", while under mushroom effect." : "."),
			comments: "Credit is determined by the last source of 'blame' at time of death. For creatures that take multiple hits, try to \"soften them up\" with more common items, before using limited ammunition to deliver the killing blow.  Creatures that \"bleed out\", can be mortally wounded (brought to or below 0 HP), before being tagged with a specific weapon to obtain credit. Conversely, weapons that do slow damage (like Spore Puff) can lose blame over time; consider carrying additional ammunition to deliver the killing blow. Starving: must be in the \"malnourished\" state; this state is cleared after eating to full.<br>" +
					"Note: the reskinned BLLs in the Past Garbage Wastes tunnel, count as both BLL and DLL for this challenge.<br>" +
					"(&lt; v1.2: If defined, <span class=\"code\">Subregion</span> takes precedence over <span class=\"code\">Region</span>. If set, <span class=\"code\">Via a Death Pit</span> takes precedence over <span class=\"code\">Weapon Used</span>.)<br>" +
					"Note: <span class=\"code\">Subregion</span> was never fully implemented, and is deprecated in v1.2+. Bingovista displays this parameter only for completeness.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoMaulTypesChallenge: function(desc, board) {
		const thisname = "BingoMaulTypesChallenge";
		//	desc of format "0", "System.Int32|4|Amount|0|NULL", "0", "0", ""
		checkDescLen(thisname, desc.length, 5);
		var items = checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "maul amount");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 1 || amt > ALL_ENUMS["creatures"].length)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
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
	BingoMaulXChallenge: function(desc, board) {
		const thisname = "BingoMaulXChallenge";
		//	desc of format ["0", "System.Int32|13|Amount|0|NULL", "0", "0"]
		checkDescLen(thisname, desc.length, 4);
		var items = checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "maul amount");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
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
	BingoNeuronDeliveryChallenge: function(desc, board) {
		const thisname = "BingoNeuronDeliveryChallenge";
		//	desc of format ["System.Int32|2|Amount of Neurons|0|NULL", "0", "0", "0"]
		checkDescLen(thisname, desc.length, 4);
		var items = checkSettingBox(thisname, desc[0], ["System.Int32", , "Amount of Neurons", , "NULL"], "neuron amount");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
		var oracle = "moon";
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Gifting neurons",
			items: ["Amount"],
			values: [String(amt)],
			description: "Deliver " + entityNameQuantify(amt, entityDisplayText("SSOracleSwarmer")) + " to " + iteratorNameToDisplayTextMap[oracle] + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "Symbol_Neuron", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "singlearrow", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: iteratorNameToIconAtlasMap[oracle], scale: 1, color: iteratorNameToIconColorMap[oracle], rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoNoNeedleTradingChallenge: function(desc, board) {
		const thisname = "BingoNoNeedleTradingChallenge";
		//	desc of format ["0", "0"]
		checkDescLen(thisname, desc.length, 2);
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
	BingoNoRegionChallenge: function(desc, board) {
		const thisname = "BingoNoRegionChallenge";
		//	desc of format ["System.String|SI|Region|0|regionsreal", "0", "0"]
		checkDescLen(thisname, desc.length, 3);
		var items = checkSettingBox(thisname, desc[0], ["System.String", , "Region", , "regionsreal"], "avoid region");
		if (BingoEnum_AllRegionCodes.indexOf(items[1]) < 0)
			throw new TypeError(thisname + ": \"" + items[1] + "\" not found in regions");
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "regionsreal");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Avoiding a region",
			items: [items[2]],
			values: [items[1]],
			description: "Do not enter " + regionToDisplayText(board.character, items[1], "Any Subregion") + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "buttonCrossA", scale: 1, color: RainWorldColors.Unity_red, rotation: 0 },
				{ type: "text", value: items[1], color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoPearlDeliveryChallenge: function(desc, board) {
		const thisname = "BingoPearlDeliveryChallenge";
		//	desc of format ["System.String|LF|Pearl from Region|0|regions", "0", "0"]
		checkDescLen(thisname, desc.length, 3);
		var items = checkSettingBox(thisname, desc[0], ["System.String", , "Pearl from Region", , "regions"], "pearl region");
		if (BingoEnum_AllRegionCodes.indexOf(items[1]) < 0)
			throw new TypeError(thisname + ": \"" + items[1] + "\" not found in regions");
		var oracle = "moon";
		if (board.character === "Artificer")
			oracle = "pebbles";
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "regions");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Delivering colored pearls to an Iterator",
			items: [items[2]],
			values: [items[1]],
			description: "Deliver " + regionToDisplayText(board.character, items[1], "Any Subregion") + " colored pearl to " + iteratorNameToDisplayTextMap[oracle] + ".",
			comments: "",
			paint: [
				{ type: "text", value: items[1], color: RainWorldColors.Unity_white },
				{ type: "icon", value: "Symbol_Pearl", scale: 1, color: entityIconColor("Pearl"), rotation: 0 },
				{ type: "break" },
				{ type: "icon", value: "singlearrow", scale: 1, color: RainWorldColors.Unity_white, rotation: 90 },
				{ type: "break" },
				{ type: "icon", value: iteratorNameToIconAtlasMap[oracle], scale: 1, color: iteratorNameToIconColorMap[oracle], rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoPearlHoardChallenge: function(desc, board) {
		const thisname = "BingoPearlHoardChallenge";
		//	desc of format (< v1.2) ["System.Boolean|false|Common Pearls|0|NULL", "System.Int32|2|Amount|1|NULL", "System.String|SL|In Region|2|regions", "0", "0"]
		//	or (>= v1.2) ["System.Boolean|true|Common Pearls|0|NULL", "System.Boolean|false|Any Shelter|2|NULL", "0", "System.Int32|2|Amount|1|NULL", "System.String|LF|Region|3|regions", "0", "0", ""]
		//	params: common, anyShelter, current, amount, region, completed, revealed, collected
		if (desc.length == 5) {
			desc.splice(1, 0, "System.Boolean|false|Any Shelter|2|NULL", "0");
			desc.push("");
		}
		checkDescLen(thisname, desc.length, 8);
		var common = checkSettingBox(thisname, desc[0], ["System.Boolean", , "Common Pearls", , "NULL"], "common pearls flag");
		var any = checkSettingBox(thisname, desc[1], ["System.Boolean", , "Any Shelter", , "NULL"], "any shelter flag");
		var amounts = checkSettingBox(thisname, desc[3], ["System.Int32", , "Amount", , "NULL"], "pearl count");
		desc[4] = desc[4].replace(/regionsreal/, "regions");	//	both acceptable (v0.85/0.90)
		desc[4] = desc[4].replace(/\|In Region\|/, "|Region|");	//	parameter name updated v1.25
		var reg = checkSettingBox(thisname, desc[4], ["System.String", , "Region", , "regions"], "region selection");
		if (common[1] !== "true" && common[1] !== "false")
			throw new TypeError(thisname + ": pearl flag \"" + common[1] + "\" not 'true' or 'false'");
		if (any[1] !== "true" && any[1] !== "false")
			throw new TypeError(thisname + ": shelter flag \"" + any[1] + "\" not 'true' or 'false'");
		var amt = parseInt(amounts[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + amounts[1] + "\" not a number or out of range");
		var r = "";
		if (reg[1] !== "Any Region") {
			if (BingoEnum_AllRegionCodes.indexOf(reg[1]) < 0)
				throw new TypeError(thisname + ": \"" + reg[1] + "\" not found in regions");
			r = ", in " + r;
		}
		var r = regionToDisplayText(board.character, reg[1], "Any Subregion");
		if (r > "") r = ", in " + r;
		var d = " common pearl";
		if (common[1] === "false") d = " colored pearl";
		if (amt == 1) d = "a" + d; else d = String(amt) + d + "s";
		if (any[1] === "true") d = "Bring " + d + ", to "; else d = "Hoard " + d + ", in ";
		if (amt == 1) d += "a shelter"; else if (any[1] === "true") d += "any shelters"; else d += "the same shelter";
		d += r + ".";
		var p = [ { type: "icon", value: ((common[1] === "true") ? "pearlhoard_normal" : "pearlhoard_color"), scale: 1, color: entityIconColor("Pearl"), rotation: 0 } ];
		if (any[1] === "true") {
			p.push( { type: "icon", value: "singlearrow", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
					{ type: "icon", value: "doubleshelter", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
		} else {
			p.unshift( { type: "icon", value: "ShelterMarker", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
		}
		if (reg[1] !== "Any Region")
			p.push( { type: "break" },
					{ type: "text", value: reg[1], color: RainWorldColors.Unity_white } );
		p.push( { type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white } );
		var b = Array(6); b.fill(0);
		b[0] = challengeValue(thisname);
		applyBool(b, 1, 4, common[1]);
		applyBool(b, 1, 5, any[1]);
		applyShort(b, 3, amt);
		b[5] = enumToValue(reg[1], "regions");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Putting pearls in shelters",
			items: [common[2], any[2], amounts[2], reg[2], "collected"],
			values: [common[1], any[1], amounts[1], reg[1], desc[7]],
			description: d,
			comments: "Note: faded pearls in Saint campaign do not count toward a \"common pearls\" goal; they still count as colored.  For example, once touched, they show on the map with their assigned (vibrant) color.  Misc pearls, and those in Iterator chambers, do not count for either type of goal.<br>" +
					"The 'one shelter' option behaves as the base Expedition goal; count is updated on shelter close.<br>" +
					"The 'any shelter' option counts the total across all shelters in the world. Counts are per pearl ID, updated when the pearl is brought into a shelter. Counts never go down, so pearls are free to use after \"hoarding\" them. Because pearls are tracked by ID, this goal cannot be cheesed by taking the same pearls between multiple shelters; multiple unique pearls must be hoarded. In short, it's the act of hoarding (putting a <em>new</em> pearl <em>in</em> a shelter) that counts up.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoPinChallenge: function(desc, board) {
		const thisname = "BingoPinChallenge";
		//	desc of format ["0", "System.Int32|5|Amount|0|NULL", "System.String|PinkLizard|Creature Type|1|creatures", "", "System.String|SU|Region|2|regions", "0", "0"]
		checkDescLen(thisname, desc.length, 7);
		var v = [], i = [];
		var items = checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "pin amount"); v.push(items[1]); i.push(items[2]);
		var items = checkSettingBox(thisname, desc[2], ["System.String", , "Creature Type", , "creatures"], "creature type"); v.push(items[1]); i.push(items[2]);
		var items = checkSettingBox(thisname, desc[4], ["System.String", , "Region", , "regions"], "region selection"); v.push(items[1]); i.push(items[2]);
		var amt = parseInt(v[0]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + v[0] + "\" not a number or out of range");
		if (v[1] !== "Any Creature" && creatureNameToDisplayTextMap[v[1]] === undefined)
			throw new TypeError(thisname + ": \"" + v[1] + "\" not found in creatures");
		var c = entityNameQuantify(amt, entityDisplayText(v[1]));
		var r = v[2];
		if (r !== "Any Region") {
			if (BingoEnum_AllRegionCodes.indexOf(v[2]) < 0)
				throw new TypeError(thisname + ": region \"" + v[2] + "\" not found in regions");
			r = regionToDisplayText(board.character, v[2], "Any Subregion");
		} else {
			r = "different regions";
		}
		var p = [ { type: "icon", value: "pin_creature", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } ];
		if (v[1] !== "Any Creature") {
			p.push( { type: "icon", value: entityIconAtlas(v[1]), scale: 1, color: entityIconColor(v[1]), rotation: 0 } );
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
	BingoPopcornChallenge: function(desc, board) {
		const thisname = "BingoPopcornChallenge";
		//	desc of format ["0", "System.Int32|6|Amount|0|NULL", "0", "0"]
		checkDescLen(thisname, desc.length, 4);
		var items = checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "pop amount");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
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
				{ type: "icon", value: "popcorn_plant", scale: 1, color: RainWorldColors.popcorn_plant, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoRivCellChallenge: function(desc, board) {
		const thisname = "BingoRivCellChallenge";
		//	desc of format ["0", "0"]
		checkDescLen(thisname, desc.length, 2);
		var b = Array(3); b.fill(0);
		b[0] = challengeValue(thisname);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Feeding the Rarefaction Cell to a Leviathan",
			items: [],
			values: [],
			description: "Feed the Rarefaction Cell to a Leviathan (completes if you die).",
			comments: "The Rarefaction Cell's immense power disturbs time itself; hence, this goal is awarded even if the player dies in the process. May our cycles meet again, little Water Dancer...",
			paint: [
				{ type: "icon", value: "Symbol_EnergyCell", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "Kill_BigEel", scale: 1, color: entityIconColor("BigEel"), rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoSaintDeliveryChallenge: function(desc, board) {
		const thisname = "BingoSaintDeliveryChallenge";
		//	desc of format ["0", "0"]
		checkDescLen(thisname, desc.length, 2);
		var oracle = "pebbles";
		var b = Array(3); b.fill(0);
		b[0] = challengeValue(thisname);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Delivering the music pearl to Five Pebbles",
			items: [],
			values: [],
			description: "Deliver the music pearl to " + iteratorNameToDisplayTextMap[oracle] + ".",
			comments: "Credit is awarded when Five Pebbles resumes playing the pearl; wait for dialog to finish, and place the pearl within reach.",
			paint: [
				{ type: "icon", value: "memoriespearl", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "singlearrow", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: iteratorNameToIconAtlasMap[oracle], scale: 1, color: iteratorNameToIconColorMap[oracle], rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoSaintPopcornChallenge: function(desc, board) {
		const thisname = "BingoSaintPopcornChallenge";
		//	desc of format ["0", "System.Int32|7|Amount|0|NULL", "0", "0"]
		checkDescLen(thisname, desc.length, 4);
		var items = checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "seed amount");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Eating popcorn plant seeds",
			items: [items[2]],
			values: [String(amt)],
			description: "Eat " + entityNameQuantify(amt, "popcorn plant seeds") + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "foodSymbol", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: "Symbol_Seed", scale: 1, color: entityIconColor("Default"), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoStealChallenge: function(desc, board) {
		const thisname = "BingoStealChallenge";
		//	assert: desc of format ["System.String|Rock|Item|1|theft",
		//	"System.Boolean|false|From Scavenger Toll|0|NULL",
		//	"0", "System.Int32|3|Amount|2|NULL", "0", "0"]
		checkDescLen(thisname, desc.length, 6);
		var v = [], i = [];
		var p = [ { type: "icon", value: "steal_item", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } ];
		var items = checkSettingBox(thisname, desc[0], ["System.String", , "Item", , "theft"], "item selection"); v.push(items[1]); i.push(items[2]);
		if (!BingoEnum_theft.includes(v[0]))
			throw new TypeError(thisname + ": item \"" + v[0] + "\" not in theft");
		items = checkSettingBox(thisname, desc[3], ["System.Int32", , "Amount", , "NULL"], "item count"); v.push(items[1]); i.push(items[2]);
		items = checkSettingBox(thisname, desc[1], ["System.Boolean", , "From Scavenger Toll", , "NULL"], "venue flag"); v.push(items[1]); i.push(items[2]);
		if (itemNameToDisplayTextMap[v[0]] === undefined)
			throw new TypeError(thisname + ": \"" + v[2] + "\" not found in items");
		var amt = parseInt(v[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + v[1] + "\" not a number or out of range");
		var d = "Steal " + entityNameQuantify(amt, entityDisplayText(v[0])) + " from ";
		p.push( { type: "icon", value: entityIconAtlas(v[0]), scale: 1, color: entityIconColor(v[0]), rotation: 0 } );
		if (v[2] === "true") {
			p.push( { type: "icon", value: "scavtoll", scale: 0.8, color: RainWorldColors.Unity_white, rotation: 0 } );
			d += "a Scavenger Toll.";
		} else if (v[2] === "false") {
			p.push( { type: "icon", value: entityIconAtlas("Scavenger"), scale: 1,
					color: entityIconColor("Scavenger"), rotation: 0 } );
			d += "Scavengers.";
		} else {
			throw new TypeError(thisname + ": flag \"" + v[2] + "\" not 'true' or 'false'");
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
	BingoTameChallenge: function(desc, board) {
		const thisname = "BingoTameChallenge";
		//	assert: desc of format ["System.String|EelLizard|Creature Type|0|friend", "0", "0"]
		//	or ["System.Boolean|true|Specific Creature Type|0|NULL", "System.String|BlueLizard|Creature Type|0|friend", "0", "System.Int32|3|Amount|3|NULL", "0", "0", ""]
		//	1.091 hack: allow 3 or 7 parameters; assume the existing parameters are ordered as expected
		if (desc.length == 3) {
			desc.unshift("System.Boolean|true|Specific Creature Type|0|NULL");
			desc.splice(2, 0, "0", "System.Int32|1|Amount|3|NULL");
			desc.push("");
		}
		checkDescLen(thisname, desc.length, 7);
		var v = [], i = [];
		var items = checkSettingBox(thisname, desc[0], ["System.Boolean", , "Specific Creature Type", , "NULL"], "creature type flag"); v.push(items[1]); i.push(items[2]);
		items = checkSettingBox(thisname, desc[1], ["System.String", , "Creature Type", , "friend"], "friend selection"); v.push(items[1]); i.push(items[2]);
		items = checkSettingBox(thisname, desc[3], ["System.Int32", , "Amount", , "NULL"], "friend count"); v.push(items[1]); i.push(items[2]);
		var amt = parseInt(v[2]);
		amt = Math.min(amt, CHAR_MAX);
		if (isNaN(amt) || amt < 1)
			throw new TypeError(thisname + ": amount \"" + v[2] + "\" not a number or out of range");
		if (v[1] !== "Any Creature" && creatureNameToDisplayTextMap[v[1]] === undefined)
			throw new TypeError(thisname + ": \"" + v[1] + "\" not found in creatures");
		var c = entityNameQuantify(1, entityDisplayText(v[1]));
		var p = [
			{ type: "icon", value: "FriendB", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 }
		];
		if (v[0] === "true") {
			p.push( { type: "icon", value: entityIconAtlas(v[1]), scale: 1, color: entityIconColor(v[1]), rotation: 0 } );
		} else if (v[0] === "false") {
			p.push( { type: "break" } );
			p.push( { type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white } );
		} else {
			throw new TypeError(thisname + ": flag \"" + v[0] + "\" not 'true' or 'false'");
		}
		var b = Array(4); b.fill(0);
		//	start with classic version...
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(v[1], "friend");
		if (v[0] === "false") {
			//	...have to use expanded form
			b[0] = challengeValue("BingoTameExChallenge");
			applyBool(b, 1, 4, v[0]);
			b.push(amt);
		}
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Befriending creatures",
			items: i,
			values: v,
			description: (v[0] === "true") ? ("Befriend " + c + ".") : ("Befriend [0/" + amt + "] unique creature types."),
			comments: "Taming occurs when a creature has been fed or rescued enough times to increase the player's reputation above some threshold, starting from a default depending on species, and the global and regional reputation of the player.<br>Feeding occurs when: 1. the player drops an edible item, creature or corpse, 2. within view of the creature, and 3. the creature bites that object. A \"happy lizard\" sound indicates success. The creature does not need to den with the item to increase reputation. Stealing the object back from the creature's jaws does not reduce reputation.<br>A rescue occurs when: 1. a creature sees or is grabbed by a threat, 2. the player attacks the threat (if the creatures was grabbed, the predator must be stunned enough to drop the creature), and 3. the creature sees the attack (or gets dropped because of it).<br>For the multiple-tame option, creature <i>types</i> count toward progress (multiple tames of a given type/color/species do not increase the count). Note that any befriendable creature type counts towards the total, including both Lizards and Squidcadas.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoTradeChallenge: function(desc, board) {
		const thisname = "BingoTradeChallenge";
		//	desc of format ["0", "System.Int32|15|Value|0|NULL", "0", "0"]
		checkDescLen(thisname, desc.length, 4);
		var items = checkSettingBox(thisname, desc[1], ["System.Int32", , "Value", , "NULL"], "points value");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
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
	BingoTradeTradedChallenge: function(desc, board) {
		const thisname = "BingoTradeTradedChallenge";
		//	desc of format ["0", "System.Int32|3|Amount of Items|0|NULL", "empty", "0", "0"]
		checkDescLen(thisname, desc.length, 5);
		var items = checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount of Items", , "NULL"], "amount of items");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
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
	BingoTransportChallenge: function(desc, board) {
		const thisname = "BingoTransportChallenge";
		//	desc of format ["System.String|Any Region|From Region|0|regions", "System.String|DS|To Region|1|regions", "System.String|CicadaA|Creature Type|2|transport", "", "0", "0"]
		checkDescLen(thisname, desc.length, 6);
		var v = [], i = [];
		var items = checkSettingBox(thisname, desc[0], ["System.String", , "From Region", , "regions"], "from region"); v.push(items[1]); i.push(items[2]);
		var items = checkSettingBox(thisname, desc[1], ["System.String", , "To Region", , "regions"], "to region"); v.push(items[1]); i.push(items[2]);
		var items = checkSettingBox(thisname, desc[2], ["System.String", , "Creature Type", , "transport"], "transportable creature type"); v.push(items[1]); i.push(items[2]);
		var r1 = v[0], r2 = v[1];
		if (r1 !== "Any Region") {
			if (BingoEnum_AllRegionCodes.indexOf(r1) < 0)
				throw new TypeError(thisname + ": \"" + v[0] + "\" not found in regions");
			r1 = regionToDisplayText(board.character, v[0], "Any Subregion");
		}
		if (r2 !== "Any Region") {
			if (BingoEnum_AllRegionCodes.indexOf(r2) < 0)
				throw new TypeError(thisname + ": \"" + v[1] + "\" not found in regions");
			r2 = regionToDisplayText(board.character, v[1], "Any Subregion");
		}
		if (creatureNameToDisplayTextMap[v[2]] === undefined)
			throw new TypeError(thisname + ": \"" + v[2] + "\" not found in creatures");
		var p = [
			{ type: "icon", value: entityIconAtlas(v[2]), scale: 1, color: entityIconColor(v[2]), rotation: 0 },
			{ type: "break" }
		];
		if (v[0] !== "Any Region") p.push( { type: "text", value: v[0], color: RainWorldColors.Unity_white } );
		p.push( { type: "icon", value: "singlearrow", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
		if (v[1] !== "Any Region") p.push( { type: "text", value: v[1], color: RainWorldColors.Unity_white } );
		var b = Array(6); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(v[0], "regions");
		b[4] = enumToValue(v[1], "regions");
		if (BingoEnum_Transportable.includes(v[2]))
			b[5] = enumToValue(v[2], "transport");
		else
			b[5] = enumToValue(v[2], "creatures") + BINARY_TO_STRING_DEFINITIONS[challengeValue(thisname)].params[2].altthreshold - 1;
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Transporting creatures",
			items: i,
			values: v,
			description: "Transport " + entityNameQuantify(1, entityDisplayText(v[2])) + " from " + r1 + " to " + r2 + ".",
			comments: "When a specific 'From' region is selected, that creature can also be brought in from an outside region, placed on the ground, then picked up in that region, to activate it for the goal. Note: keeping a swallowable creature always in stomach will NOT count in this way, nor will throwing it up and only holding in hand (and not dropping then regrabbing).",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoUnlockChallenge: function(desc, board) {
		const thisname = "BingoUnlockChallenge";
		//	desc of format ["System.String|SingularityBomb|Unlock|0|unlocks", "0", "0"]
		checkDescLen(thisname, desc.length, 3);
		var items = checkSettingBox(thisname, desc[0], ["System.String", , "Unlock", , "unlocks"], "unlock selection");
		var iconName = "", iconColor = RainWorldColors.Unity_white;
		var p = [
			{ type: "icon", value: "arenaunlock", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
			{ type: "break" }
		];
		var d;
		if (BingoEnum_ArenaUnlocksBlue.includes(items[1])) {
			p[0].color = RainWorldColors.AntiGold;
			iconName = entityIconAtlas(items[1]);
			iconColor = entityIconColor(items[1]);
			if (creatureNameToIconAtlasMap[items[1]] === undefined && itemNameToIconAtlasMap[items[1]] === undefined)
				throw new TypeError(thisname + ": \"" + items[1] + "\" not found in items or creatures");
			d = entityDisplayText(items[1]);
		} else if (BingoEnum_ArenaUnlocksGold.includes(items[1])) {
			p[0].color = RainWorldColors.TokenDefault;
			if (!(regionCodeToDisplayName[items[1]] || regionCodeToDisplayNameSaint[items[1]] || arenaUnlocksGoldToDisplayName[items[1]]))
				throw new TypeError(thisname + ": arena \"" + items[1] + "\" not found in regions or arenaUnlocksGold");
			d = (arenaUnlocksGoldToDisplayName[items[1]] || regionToDisplayText(board.character, items[1], "Any Subregion")) + " Arenas";
		} else if (BingoEnum_ArenaUnlocksGreen.includes(items[1])) {
			p[0].color = RainWorldColors.GreenColor;
			iconName = "Kill_Slugcat";
			iconColor = RainWorldColors["Slugcat_" + items[1]];
			if (iconColor === undefined)
				throw new TypeError(thisname + ": \"Slugcat_" + items[1] + "\" not found in characters");
			d = items[1] + " character"
		} else if (BingoEnum_ArenaUnlocksRed.includes(items[1])) {
			p[0].color = RainWorldColors.RedColor;
			var s = items[1].substring(0, items[1].search("-"));
			if (BingoEnum_AllRegionCodes.indexOf(s) < 0)
				throw new TypeError(thisname + ": \"" + s + "\" not found in regions");
			d = regionToDisplayText(board.character, s, "Any Subregion") + " Safari";
		} else {
			throw new TypeError(thisname + ": \"" + items[1] + "\" not a recognized arena unlock");
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
			description: "Get the " + d + " unlock.",
			comments: "",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoVistaChallenge: function(desc, board) {
		const thisname = "BingoVistaChallenge";
		//	desc of format ["CC", "System.String|CC_A10|Room|0|vista", "734", "506", "0", "0"]
		checkDescLen(thisname, desc.length, 6);
		var items = checkSettingBox(thisname, desc[1], ["System.String", , "Room", , "vista"], "item selection");
		//	desc[0] is region code
		if (desc[0] != regionOfRoom(items[1]))
			throw new TypeError(thisname + ": \"" + desc[0] + "\" does not match room \"" + items[1] + "\"'s region prefix");
		if (BingoEnum_AllRegionCodes.indexOf(desc[0]) < 0)
			throw new TypeError(thisname + ": \"" + desc[0] + "\" not found in regions");
		var v = regionToDisplayText(board.character, desc[0], "Any Subregion");
		var roomX = parseInt(desc[2]);
		if (isNaN(roomX) || roomX < -INT_MAX || roomX > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + desc[2] + "\" not a number or out of range");
		var roomY = parseInt(desc[3]);
		if (isNaN(roomY) || roomY < -INT_MAX || roomY > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + desc[3] + "\" not a number or out of range");
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
			b[0] = challengeValue("BingoVistaExChallenge");
			b[3] = idx + 1;
			b[2] = b.length - GOAL_LENGTH;
		}
		return {
			name: thisname,
			category: "Visiting Vistas",
			items: ["Region"],
			values: [desc[0]],
			description: "Reach the vista point in " + v + ".",
			comments: "Room: " + items[1] + " at x: " + String(roomX) + ", y: " + String(roomY) + "; is a " + ((idx >= 0) ? "stock" : "customized") + " location." + getMapLink(items[1], board.character) + "<br>Note: the room names for certain Vista Points in Spearmaster/Artificer Garbage Wastes, and Rivulet Underhang, are not generated correctly for their world state, and so may not show correctly on the map; the analogous rooms are however fixed up in-game.",
			paint: [
				{ type: "icon", value: "vistaicon", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: desc[0], color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoVistaExChallenge: function(desc, board) {
		return CHALLENGES.BingoVistaChallenge(desc, board);
	},
	//	Challenges are alphabetical up to here (initial version); new challenges/variants added chronologically below
	//	added 0.86 (in 0.90 update cycle)
	BingoEnterRegionFromChallenge: function(desc, board) {
		const thisname = "BingoEnterRegionFromChallenge";
		//	desc of format ["System.String|GW|From|0|regionsreal", "System.String|SH|To|0|regionsreal", "0", "0"]
		checkDescLen(thisname, desc.length, 4);
		var items = checkSettingBox(thisname, desc[0], ["System.String", , "From", , "regionsreal"], "from region");
		var itemTo = checkSettingBox(thisname, desc[1], ["System.String", , "To", , "regionsreal"], "to region");
		if (BingoEnum_AllRegionCodes.indexOf(items[1]) < 0)
			throw new TypeError(thisname + ": from \"" + items[1] + "\" not found in regions");
		if (BingoEnum_AllRegionCodes.indexOf(itemTo[1]) < 0)
			throw new TypeError(thisname + ": to \"" + itemTo[1] + "\" not found in regions");
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
			description: "First time entering " + regionToDisplayText(board.character, itemTo[1], "Any Subregion") + " must be from " + regionToDisplayText(board.character, items[1], "Any Subregion") + ".",
			comments: "",
			paint: [
				{ type: "text", value: items[1], color: RainWorldColors.Unity_white },
				{ type: "icon", value: "keyShiftA", scale: 1, color: RainWorldColors.EnterFrom, rotation: 90 },
				{ type: "text", value: itemTo[1], color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoMoonCloakChallenge: function(desc, board) {
		const thisname = "BingoMoonCloakChallenge";
		//	desc of format ["System.Boolean|false|Deliver|0|NULL", "0", "0"]
		checkDescLen(thisname, desc.length, 3);
		var items = checkSettingBox(thisname, desc[0], ["System.Boolean", , "Deliver", , "NULL"], "delivery flag");
		if (items[1] !== "true" && items[1] !== "false")
			throw new TypeError(thisname + ": delivery flag \"" + items[1] + "\" not 'true' or 'false'");
		var p = [ { type: "icon", value: "Symbol_MoonCloak", scale: 1, color: entityIconColor("MoonCloak"), rotation: 0 } ];
		if (items[1] === "true") {
			p.push( { type: "icon", value: "singlearrow", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 } );
			p.push( { type: "icon", value: "GuidanceMoon", scale: 1, color: RainWorldColors.GuidanceMoon, rotation: 0 } );
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
			description: ((items[1] === "false") ? "Obtain Moon's Cloak." : "Deliver the Cloak to Moon."),
			comments: "With only a 'Deliver' goal on the board, players will spawn with the Cloak in the starting shelter, and must deliver it to Looks To The Moon. If both Obtain and Deliver are present, players must obtain the Cloak from Submerged Superstructure first, and then deliver it.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoBroadcastChallenge: function(desc, board) {
		const thisname = "BingoBroadcastChallenge";
		//	desc of format ["System.String|Chatlog_SI3|Broadcast|0|chatlogs", "0", "0"]
		checkDescLen(thisname, desc.length, 3);
		var items = checkSettingBox(thisname, desc[0], ["System.String", , "Broadcast", , "chatlogs"], "broadcast selection");
		var r = items[1].substring(items[1].search("_") + 1);
		if (r.search(/[0-9]/) >= 0) r = r.substring(0, r.search(/[0-9]/));
		r = (regionCodeToDisplayName[r] || "");
		if (r > "") r = " in " + r;
		if (enumToValue(items[1], "chatlogs") <= 0)
			throw new TypeError(thisname + ": item \"" + items[1] + "\" not found in chatlogs");
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "chatlogs");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Getting Chat Logs",
			items: ["Broadcast"],
			values: [items[1]],
			description: "Get the " + items[1] + " chat log" + r + ".",
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
	 *	Stubs to maintain extended BINARY_TO_STRING_DEFINITIONS entries.
	 *	See binGoalToText() and ChallengeUpgrades[]; these names are
	 *	replaced with their originals to maintain compatibility.  */
	BingoDamageExChallenge: function(desc, board) {
		return CHALLENGES.BingoDamageChallenge(desc, board);
	},
	BingoTameExChallenge: function(desc, board) {
		return CHALLENGES.BingoTameChallenge(desc, board);
	},
	/*	added 1.2 */
	BingoBombTollExChallenge: function(desc, board) {
		return CHALLENGES.BingoBombTollChallenge(desc, board);
	},
	BingoDodgeNootChallenge: function(desc, board) {
		const thisname = "BingoDodgeNootChallenge";
		//	desc of format ["System.Int32|6|Amount|0|NULL", "0", "0", "0"]
		//	amount, current, completed, revealed
		checkDescLen(thisname, desc.length, 4);
		var items = checkSettingBox(thisname, desc[0], ["System.Int32", , "Amount", , "NULL"], "amount");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Dodging Noodlefly attacks",
			items: ["Amount"],
			values: [String(amt)],
			description: "Dodge [0/" + String(amt) + "] Noodlefly attacks.",
			comments: "",
			paint: [
				{ type: "icon", value: entityIconAtlas("BigNeedleWorm"), scale: 1, color: entityIconColor("BigNeedleWorm"), rotation: 0 },
				{ type: "icon", value: "slugtarget", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoDontKillChallenge: function(desc, board) {
		const thisname = "BingoDontKillChallenge";
		//	desc of format ["System.String|DaddyLongLegs|Creature Type|0|creatures", "0", "0"]
		//	victim, completed, revealed
		checkDescLen(thisname, desc.length, 3);
		var items = checkSettingBox(thisname, desc[0], ["System.String", , "Creature Type", , "creatures"], "creature type");
		if (items[1] !== "Any Creature") {
			if (creatureNameToDisplayTextMap[items[1]] === undefined)
				throw new TypeError(thisname + ": \"" + items[1] + "\" not found in creatures");
		}
		var p = [
			{ type: "icon", value: "buttonCrossA", scale: 1, color: RainWorldColors.Unity_red, rotation: 0 },
			{ type: "icon", value: "Multiplayer_Bones", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 }
		];
		if (items[1] !== "Any Creature")
			p.push( { type: "icon", value: entityIconAtlas(items[1]), scale: 1, color: entityIconColor(items[1]), rotation: 0 } );
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "creatures");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Avoiding killing creatures",
			items: [items[2]],
			values: [items[1]],
			description: "Never kill " + entityDisplayText(items[1]) + ".",
			comments: "",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoEchoExChallenge: function(desc, board) {
		return CHALLENGES.BingoEchoChallenge(desc, board);
	},
	BingoGourmandCrushChallenge: function(desc, board) {
		const thisname = "BingoGourmandCrushChallenge";
		//	desc of format ["0", "System.Int32|9|Amount|0|NULL", "0", "0", ""]
		//	current, amount, completed, revealed, crushed
		checkDescLen(thisname, desc.length, 5);
		var items = checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "amount");
		var amt = parseInt(items[1]);
		amt = Math.min(amt, CHAR_MAX);
		if (isNaN(amt) || amt < 1)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = amt;
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Crushing creatures",
			items: ["Amount"],
			values: [String(amt)],
			description: "Crush " + ((amt > 1) ? (String(amt) + " unique creatures") : ("a creature")) + " by falling.",
			comments: "",
			paint: [
				{ type: "icon", value: "gourmcrush", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoItemHoardExChallenge: function(desc, board) {
		return CHALLENGES.BingoItemHoardChallenge(desc, board);
	},
	BingoIteratorChallenge: function(desc, board) {
		const thisname = "BingoIteratorChallenge";
		//	desc of format ["System.Boolean|false|Looks to the Moon|0|NULL", "0", "0"]
		//	oracle, completed, revealed
		checkDescLen(thisname, desc.length, 3);
		var oracle = checkSettingBox(thisname, desc[0], ["System.Boolean", , "Looks to the Moon", , "NULL"], "Moon flag");
		if (iteratorNameToDisplayTextMap[oracle[1]] === undefined)
			throw new TypeError(thisname + ": flag \"" + oracle[1] + "\" not 'true' or 'false'");
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(oracle[1], "iterators");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Visiting Iterators",
			items: [oracle[2]],
			values: [oracle[1]],
			description: "Visit " + iteratorNameToDisplayTextMap[oracle[1]] + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "singlearrow", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "icon", value: iteratorNameToIconAtlasMap[oracle[1]], scale: 1, color: iteratorNameToIconColorMap[oracle[1]], rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoLickChallenge: function(desc, board) {
		const thisname = "BingoLickChallenge";
		//	desc of format ["0", "System.Int32|{0}|Amount|0|NULL", "0", "0", ""]
		//	current, amount, completed, revealed, lickers
		checkDescLen(thisname, desc.length, 5);
		var amounts = checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "amount");
		var amt = parseInt(amounts[1]);
		amt = Math.min(amt, CHAR_MAX);
		if (isNaN(amt) || amt < 1)
			throw new TypeError(thisname + ": amount \"" + amounts[1] + "\" not a number or out of range");
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = amt;
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Getting licked by lizards",
			items: ["Amount"],
			values: [String(amt)],
			description: "Get licked by " + ((amt > 1) ? (String(amt) + " different individual lizards.") : ("a lizard.")),
			comments: "",
			paint: [
				{ type: "icon", value: "lizlick", scale: 1, color: RainWorldColors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: RainWorldColors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	}
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
	"DataPearl",	//	added by GetCorrectListForChallenge()
	//	ScavengerAI::CollectScore (nonzero values)
	"ExplosiveSpear",
	"ElectricSpear",
	"PuffBall",
	"FlareBomb",
	"KarmaFlower",
	"Mushroom",
	"VultureMask",
	"OverseerCarcass",
	"FirecrackerPlant",
	"JellyFish",
	"FlyLure",
	"SporePlant",
	"LillyPuck",
	"SingularityBomb"
];

/**
 *	Expedition items; used by BingoItemHoardChallenge
 *	Value type: internal item name
 */
const BingoEnum_expobject = [
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
	"DangleFruit",	//	foods added v1.04
	"SlimeMold",
	"BubbleGrass",	//	still more foods v1.2
	"EggBugEgg",
	"GooieDuck",
	"LillyPuck",
	"DandelionPeach",
	//	1.25: adding every possible type that can proc (hopefully?)
	//	AbstractPhysicalObject.AbstractObjectType
	"Creature",
	"Rock",
	"Spear",
	"Oracle",
	"PebblesPearl",
	"SLOracleSwarmer",
	"SSOracleSwarmer",
	"DataPearl",
	"SeedCob",
	"WaterNut",
	"KarmaFlower",
	"VoidSpawn",
	"AttachedBee",
	"NeedleEgg",
	"DartMaggot",
	"NSHSwarmer",
	"OverseerCarcass",
	"CollisionField",
	"BlinkingFlower",
	"Pomegranate",
	"LobeTree",
	//	MoreSlugcatsEnums.AbstractObjectType
	"JokeRifle",
	"Bullet",
	"Spearmasterpearl",
	"FireEgg",
	"EnergyCell",
	"Germinator",
	"MoonCloak",
	"HalcyonPearl",
	"HRGuard",
	"Seed",
	"GlowWeed",
	//	DLCSharedEnums.AbstractObjectType
	"SingularityBomb"
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
	"LillyPuck",
	"SingularityBomb"
];

/**
 *	Don't-use-able items; used by BingoDontUseItemChallenge
 *	Value type: internal item name
 */
const BingoEnum_Bannable = [
	//	BingoEnum_FoodTypes (stock v0.9)
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
	//	ChallengeUtils.Bannable (v0.9)
	"Lantern",
	"PuffBall",
	"VultureMask",
	"ScavengerBomb",
	"FirecrackerPlant",
	"BubbleGrass",
	"Rock",
	//	More foods added v1.2
	"SSOracleSwarmer",
	"KarmaFlower",
	"FireEgg",
	"DataPearl",
	//	1.25: adding every possible type that can proc (hopefully?)
	"SporePlant",
	"FlareBomb",
	"FlyLure",
	//	AbstractPhysicalObject.AbstractObjectType
	"Creature",
	"Spear",
	"Oracle",
	"PebblesPearl",
	"SLOracleSwarmer",
	"SeedCob",
	"VoidSpawn",
	"AttachedBee",
	"NeedleEgg",
	"DartMaggot",
	"NSHSwarmer",
	"OverseerCarcass",
	"CollisionField",
	"BlinkingFlower",
	"Pomegranate",
	"LobeTree",
	//	MoreSlugcatsEnums.AbstractObjectType
	"JokeRifle",
	"Bullet",
	"Spearmasterpearl",
	"EnergyCell",
	"Germinator",
	"MoonCloak",
	"HalcyonPearl",
	"HRGuard",
	"Seed",
	//	DLCSharedEnums.AbstractObjectType
	"SingularityBomb"
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
	//	v1.2: add all remaining possibilities from the crafting table
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
	"SSOracleSwarmer",	//	added v1.2
	"KarmaFlower",	//	and remaining possibilities why not (from IPlayerEdible references)
	"FireEgg",
	"SLOracleSwarmer"	//	guess I forgot one
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
	"UNKNOWN": "UNKNOWN",
	//	Watcher regions, from https://alduris.github.io/watcher-map/
	"WARF": "Aether Ridge",
	"WBLA": "Badlands",
	"WARD": "Cold Storage",
	"WRFA": "Coral Caves",
	"WTDB": "Desolate Tract",
	"WARC": "Fetid Glen",
	"WVWB": "Fractured Gateways",
	"WARE": "Heat Ducts",
	"WMPA": "Migration Path",
	"WPGA": "Pillar Grove",
	"WRRA": "Rusted Wrecks",
	"WARB": "Salination",
	"WSKD": "Shrouded Stacks",
	"WPTA": "Signal Spires",
	"WSKC": "Stormy Coast",
	"WSKB": "Sunbaked Alley",
	"WARG": "The Surface",
	"WSKA": "Torrential Railways",
	"WTDA": "Torrid Desert",
	"WRFB": "Turbulent Pump",
	"WVWA": "Verdant Waterways",
	"WARA": "Shattered Terrace",
	"WRSA": "Daemon",
	"WAUA": "Ancient Urban",
	"WHIR": "Corrupted Factories",
	"WSUR": "Crumbling Fringes",
	"WDSR": "Decaying Tunnels",
	"WGWR": "Infested Wastes",
	"WSSR": "Unfortunate Evolution",
	"WORA": "Outer Rim"
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
	"UW", "VS",
	//	Watcher regions
	"WARF", "WBLA", "WARD", "WRFA",
	"WTDB", "WARC", "WVWB", "WARE",
	"WMPA", "WPGA", "WRRA", "WARB",
	"WSKD", "WPTA", "WSKC", "WSKB",
	"WARG", "WSKA", "WTDA", "WRFB",
	"WVWA", "WARA", "WRSA", "WAUA",
	"WHIR", "WSUR", "WDSR", "WGWR", 
	"WSSR", "WORA"
];

/**
 *	All subregions.  Used by BingoDamageChallenge and BingoKillChallenge
 *	for legacy support.  Concatenation of BingoEnum_Subregions and
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
	//	Watcher subregions
	//	subregions deprecated, no adds needed
];

/**
 *	Creatures that can be dropped in the Depths pit.
 *	Used by BingoDepthsChallenge.
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
 *	Transportable creature targets; used by BingoCreatureGateChallenge,
 *	BingoDepthsChallenge, and BingoTransportChallenge.
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
 *	Deprecated; use creatures instead.
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
 *	Value type: string, room name (lowercase)
 */
const BingoEnum_BombableOutposts = [
	"su_c02",
	"gw_c05",
	"gw_c11",
	"lf_e03",
	"ug_toll",
	"cl_a34",	//	customization-proofing
	"cl_b27",
	"lc_c10",
	"lc_longslum",
	"lc_rooftophop",
	"lc_templetoll",
	"lc_stripmallnew",
	"lf_j01",
	"oe_tower04",
	"sb_topside",
	//	Watcher tolls
	"warf_g01",
	"wbla_f01",
	"wskd_b41"
];

/**
 *	Used by BingoBombTollExChallenge dictionary
 *	Value type: string, room name (lowercase) concatenated with
 *	"|" separator then boolean value
 *	Default value: index 0 gives "empty" dict value
 */
const BingoEnum_BombedDict = [
	"empty",	//	default
	//	false's
	"SU_C02|false",	//	base list
	"GW_C05|false",
	"GW_C11|false",
	"LF_E03|false",
	"UG_TOLL|false",
	"CL_A34|false",	//	customization-proofing
	"CL_B27|false",
	"LC_C10|false",
	"LC_longslum|false",
	"LC_rooftophop|false",
	"LC_templetoll|false",
	"LC_stripmallNEW|false",
	"LF_J01|false",
	"OE_TOWER04|false",
	"SB_TOPSIDE|false",
	//	true's
	"SU_C02|true",
	"GW_C05|true",
	"GW_C11|true",
	"LF_E03|true",
	"UG_TOLL|true",
	"CL_A34|true",
	"CL_B27|true",
	"LC_C10|true",
	"LC_longslum|true",
	"LC_rooftophop|true",
	"LC_templetoll|true",
	"LC_stripmallNEW|true",
	"LF_J01|true",
	"OE_TOWER04|true",
	"SB_TOPSIDE|true",
	//	Watcher addons
	"warf_g01|false",
	"wbla_f01|false",
	"wskd_b41|false",
	"warf_g01|true",
	"wbla_f01|true",
	"wskd_b41|true"
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
	"ZoopLizard",
	"SeedCob"	//	thanks Watcher
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
	"Spearmaster",
	"Watcher"
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

/** Populated on startup by expandAndValidateLists() */
const BingoEnum_AllUnlocks = [];

/**
 *	Assorted color constants that don't belong
 *	to any particular object, type or class
 *	Key type: internal name
 *	Value type: string, HTML color (7 chars)
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
 *	Convert creature name to icon color.
 *	Refactoring of creatureNameToIconColor() to associative array.
 *	Sorted to match creatureNameToIconAtlasMap (with defaults removed).
 *	Key type: internal creature name
 *	Value type: string, HTML color (7 chars)
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
	//	Bingo, ChallengeUtils::ChallengeTools_ItemName
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
	"Default":          "Unknown Items",
	"SeedCob":          "Popcorn Plants",	//	(Watcher 1.5) not exactly an item, but it goes in the unlocks all the same
	"ExplosiveSpear":   "Explosive Spears"	//	for redundancy
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
	"Pearl":            "Symbol_Pearl",
	"KarmaFlower":      "FlowerMarker",
	"SeedCob":          "popcorn_plant",
	"ExplosiveSpear":   "Symbol_FireSpear"
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
 *	Value type: string, HTML color (7 chars)
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
 *	Key type: internal item name, or pearl name with "Pearl_" prepended
 *	Value type: string, HTML color (7 chars)
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
	"MoonCloak":              "#f3fff5",	//	was "#cccccc"?
	"FireEgg":                "#ff7878",
	//	Used by unlock tokens (why are they different :agony: )
	"ElectricSpear":          "#0000ff",
	"FireSpear":              "#e60e0e",
	"Pearl":                  "#b3b3b3",
	"SeedCob":                RainWorldColors.popcorn_plant,
	"ExplosiveSpear":         "#ff7878",
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


/* * * Additional or Binary Format Enums * * */

/* * * These are commented on in format.txt * * */

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
 *		Object.keys(BINARY_TO_STRING_DEFINITIONS)[idx].name
 *		BINARY_TO_STRING_DEFINITIONS.findIndex(a => a.name === txt)
 *	Populated by expandAndValidateLists().
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

/** Perk and burden group names; see: Expedition.ExpeditionProgression */
const BingoEnum_EXPFLAGS_Groups = {
	"LANTERN":   "unl-lantern",
	"MASK":      "unl-vulture",
	"BOMB":      "unl-bomb",
	"NEURON":    "unl-glow",
	"BACKSPEAR": "unl-backspear",
	"FLOWER":    "unl-karma",
	"PASSAGE":   "unl-passage",
	"SLOWTIME":  "unl-slow",
	"SINGUBOMB": "unl-sing",
	"ELECSPEAR": "unl-electric",
	"DUALWIELD": "unl-dualwield",
	"EXPRESIST": "unl-explosionimmunity",
	"EXPJUMP":   "unl-explosivejump",
	"CRAFTING":  "unl-crafting",
	"AGILITY":   "unl-agility",
	"RIFLE":     "unl-gun",
	"BLINDED":   "bur-blinded",
	"DOOMED":    "bur-doomed",
	"HUNTED":    "bur-hunted",
	"PURSUED":   "bur-pursued"
};

/** Currently unused, but for reference; from Watcher Expeditions Mod */
const EXPFLAGS_WatcherExpedition = [
	{ name: "WA_CAMO",   value: 0x00800000, title: "Perk: Camouflage",      group: "unl-watcher-camo"        },
	{ name: "WA_RANG",   value: 0x01000000, title: "Perk: Permanent Warps", group: "unl-watcher-permwarp"    },
	{ name: "WA_POISON", value: 0x02000000, title: "Perk: Poison Spear",    group: "unl-watcher-PoisonSpear" },
	{ name: "WA_WARP",   value: 0x04000000, title: "Perk: Boomerang Fever", group: "unl-watcher-boomerang"   },
	{ name: "WA_ROTTED", value: 0x08000000, title: "Burden: Rotten",        group: "bur-watcher_rot"         }
];

/**
 *	Boolean strings, for completeness.
 */
const BingoEnum_Boolean = [
	"false",
	"true"
];

/**
 *	All visitable Iterators.
 *	v1.2: BingoIteratorChallenge uses a Boolean flag to select base options;
 *	this seems fragile for expansion, so, anticipating some flexibility here
 *	and promoting to a String enum.  Hence the odd value of the first two
 *	entries.
 */
const BingoEnum_Iterators = [
	"true", 	//	Looks To The Moon
	"false" 	//	Five Pebbles
];

const iteratorNameToDisplayTextMap = {
	"true":    "Looks To The Moon",
	"false":   "Five Pebbles",
	"moon":    "Looks To The Moon",
	"pebbles": "Five Pebbles"
};

const iteratorNameToIconAtlasMap = {
	"true":    "GuidanceMoon",
	"false":   "nomscpebble",
	"moon":    "GuidanceMoon",
	"pebbles": "nomscpebble"
};

const iteratorNameToIconColorMap = {
	"true":    RainWorldColors.GuidanceMoon,
	"false":   RainWorldColors.nomscpebble,
	"moon":    RainWorldColors.GuidanceMoon,
	"pebbles": RainWorldColors.nomscpebble
};

/**
 *	Stock (built in / mod generated) Vista Point locations.
 */
const BingoEnum_VistaPoints = [
	//	Base Expedition
	{ region: "CC", room: "CC_A10",         x:  734, y:  506 },
	{ region: "CC", room: "CC_B12",         x:  455, y: 1383 },
	{ region: "CC", room: "CC_C05",         x:  449, y: 2330 },
	{ region: "CL", room: "CL_C05",         x:  540, y: 1213 },
	{ region: "CL", room: "CL_H02",         x: 2407, y: 1649 },
	{ region: "CL", room: "CL_CORE",        x:  471, y:  373 },
	{ region: "DM", room: "DM_LAB1",        x:  486, y:  324 },
	{ region: "DM", room: "DM_LEG06",       x:  400, y:  388 },
	{ region: "DM", room: "DM_O02",         x: 2180, y: 2175 },
	{ region: "DS", room: "DS_A05",         x:  172, y:  490 },
	{ region: "DS", room: "DS_A19",         x:  467, y:  545 },
	{ region: "DS", room: "DS_C02",         x:  541, y: 1305 },
	{ region: "GW", room: "GW_C09",         x:  607, y:  595 },
	{ region: "GW", room: "GW_D01",         x: 1603, y:  595 },
	{ region: "GW", room: "GW_E02",         x: 2608, y:  621 },
	{ region: "HI", room: "HI_B04",         x:  214, y:  615 },
	{ region: "HI", room: "HI_C04",         x:  800, y:  768 },
	{ region: "HI", room: "HI_D01",         x: 1765, y:  655 },
	{ region: "LC", room: "LC_FINAL",       x: 2700, y:  500 },
	{ region: "LC", room: "LC_SUBWAY01",    x: 1693, y:  564 },
	{ region: "LC", room: "LC_tallestconnection", x:  153, y:  242 },
	{ region: "LF", room: "LF_A10",         x:  421, y:  412 },
	{ region: "LF", room: "LF_C01",         x: 2792, y:  423 },
	{ region: "LF", room: "LF_D02",         x: 1220, y:  631 },
	{ region: "OE", room: "OE_RAIL01",      x: 2420, y: 1378 },
	{ region: "OE", room: "OE_RUINCourtYard", x: 2133, y: 1397 },
	{ region: "OE", room: "OE_TREETOP",     x:  468, y: 1782 },
	{ region: "RM", room: "RM_ASSEMBLY",    x: 1550, y:  586 },
	{ region: "RM", room: "RM_CONVERGENCE", x: 1860, y:  670 },
	{ region: "RM", room: "RM_I03",         x:  276, y: 2270 },
	{ region: "SB", room: "SB_D04",         x:  483, y: 1045 },
	{ region: "SB", room: "SB_E04",         x: 1668, y:  567 },
	{ region: "SB", room: "SB_H02",         x: 1559, y:  472 },
	{ region: "SH", room: "SH_A14",         x:  273, y:  556 },
	{ region: "SH", room: "SH_B05",         x:  733, y:  453 },
	{ region: "SH", room: "SH_C08",         x: 2159, y:  481 },
	{ region: "SI", room: "SI_C07",         x:  539, y: 2354 },
	{ region: "SI", room: "SI_D05",         x: 1045, y: 1258 },
	{ region: "SI", room: "SI_D07",         x:  200, y:  400 },
	{ region: "SL", room: "SL_B01",         x:  389, y: 1448 },
	{ region: "SL", room: "SL_B04",         x:  390, y: 2258 },
	{ region: "SL", room: "SL_C04",         x:  542, y: 1295 },
	{ region: "SU", room: "SU_A04",         x:  265, y:  415 },
	{ region: "SU", room: "SU_B12",         x: 1180, y:  382 },
	{ region: "SU", room: "SU_C01",         x:  450, y: 1811 },
	{ region: "UG", room: "UG_A16",         x:  640, y:  354 },
	{ region: "UG", room: "UG_D03",         x:  857, y: 1826 },
	{ region: "UG", room: "UG_GUTTER02",    x:  163, y:  241 },
	{ region: "UW", room: "UW_A07",         x:  805, y:  616 },
	{ region: "UW", room: "UW_C02",         x:  493, y:  490 },
	{ region: "UW", room: "UW_J01",         x:  860, y: 1534 },
	{ region: "VS", room: "VS_C03",         x:   82, y:  983 },
	{ region: "VS", room: "VS_F02",         x: 1348, y:  533 },
	{ region: "VS", room: "VS_H02",         x:  603, y: 3265 },
	//	Bingo customs/adders                
	{ region: "CC", room: "CC_SHAFT0x",     x: 1525, y:  217 },
	{ region: "CL", room: "CL_C03",         x:  808, y:   37 },
	{ region: "DM", room: "DM_VISTA",       x:  956, y:  341 },
	{ region: "DS", room: "DS_GUTTER02",    x:  163, y:  241 },
	{ region: "GW", room: "GW_A24",         x:  590, y:  220 },
	{ region: "HI", room: "HI_B02",         x:  540, y: 1343 },
	{ region: "LC", room: "LC_stripmallNEW", x: 1285, y:   50 },
	{ region: "LF", room: "LF_E01",         x:  359, y:   63 },
	{ region: "LM", room: "LM_B01",         x:  248, y: 1507 },
	{ region: "LM", room: "LM_B04",         x:  503, y: 2900 },
	{ region: "LM", room: "LM_C04",         x:  542, y: 1295 },
	{ region: "LM", room: "LM_EDGE02",      x: 1750, y: 1715 },
	{ region: "MS", room: "MS_AIR03",       x: 1280, y:  770 },
	{ region: "MS", room: "MS_ARTERY01",    x: 4626, y:   39 },
	{ region: "MS", room: "MS_FARSIDE",     x: 2475, y: 1800 },
	{ region: "MS", room: "MS_LAB4",        x:  390, y:  240 },
	{ region: "OE", room: "OE_CAVE02",      x: 1200, y:   35 },
	{ region: "RM", room: "RM_LAB8",        x: 1924, y:   65 },
	{ region: "SB", room: "SB_C02",         x: 1155, y:  550 },
	{ region: "SH", room: "SH_E02",         x:  770, y:   40 },
	{ region: "SI", room: "SI_C04",         x: 1350, y:  130 },
	{ region: "SL", room: "SL_AI",          x: 1530, y:   15 },
	{ region: "SS", room: "SS_A13",         x:  347, y:  595 },
	{ region: "SS", room: "SS_C03",         x:   60, y:  119 },
	{ region: "SS", room: "SS_D04",         x:  980, y:  440 },
	{ region: "SS", room: "SS_LAB12",       x:  697, y:  255 },
	{ region: "SU", room: "SU_B11",         x:  770, y:   48 },
	{ region: "UG", room: "UG_A19",         x:  545, y:   43 },
	{ region: "UW", room: "UW_D05",         x:  760, y:  220 },
	{ region: "VS", room: "VS_E06",         x:  298, y: 1421 },
	//	Watcher addons
	{ region: "WARF", room: "WARF_B17",     x:  461, y:  290 },
	{ region: "WARF", room: "WARF_C02",     x: 2110, y:  330 },
	{ region: "WARF", room: "WARF_D26",     x:  600, y:  100 },
	{ region: "WBLA", room: "WBLA_F02",     x: 5180, y:  700 },
	{ region: "WBLA", room: "WBLA_B05",     x: 1650, y:  490 },
	{ region: "WBLA", room: "WBLA_J01",     x: 4853, y:  650 },
	{ region: "WARD", room: "WARD_D36",     x:  590, y:  570 },
	{ region: "WARD", room: "WARD_E26",     x: 1300, y:  590 },
	{ region: "WARD", room: "WARD_E28",     x:  590, y:  290 },
	{ region: "WRFA", room: "WRFA_F06",     x: 1290, y: 1525 },
	{ region: "WRFA", room: "WRFA_E02",     x: 1488, y:  300 },
	{ region: "WRFA", room: "WRFA_SK0",     x:   25, y:  250 },
	{ region: "WTDB", room: "WTDB_A08",     x:  475, y:  634 },
	{ region: "WTDB", room: "WTDB_A22",     x: 1545, y:  660 },
	{ region: "WTDB", room: "WTDB_A38",     x:  950, y:  610 },
	{ region: "WARC", room: "WARC_A01",     x:  905, y:  550 },
	{ region: "WARC", room: "WARC_A05",     x: 2450, y:  570 },
	{ region: "WARC", room: "WARC_E03",     x: 1511, y:  970 },
	{ region: "WVWB", room: "WVWB_C01",     x: 2460, y:  440 },
	{ region: "WVWB", room: "WVWB_D02",     x: 1315, y:  410 },
	{ region: "WVWB", room: "WVWB_E02",     x: 1559, y:  870 },
	{ region: "WARE", room: "WARE_H03",     x:  434, y:  625 },
	{ region: "WARE", room: "WARE_H24",     x:  475, y: 1095 },
	{ region: "WARE", room: "WARE_I04",     x:  715, y:  100 },
	{ region: "WMPA", room: "WMPA_D07",     x:  705, y:  935 },
	{ region: "WMPA", room: "WMPA_A08",     x: 1265, y:  450 },
	{ region: "WMPA", room: "WMPA_C03",     x: 1111, y:  570 },
	{ region: "WPGA", room: "WPGA_A09",     x:  150, y:  400 },
	{ region: "WPGA", room: "WPGA_A14",     x:  491, y:  630 },
	{ region: "WPGA", room: "WPGA_A13",     x:  733, y:  645 },
	{ region: "WRRA", room: "WRRA_A09",     x:  492, y:  328 },
	{ region: "WRRA", room: "WRRA_C03",     x: 1472, y:  348 },
	{ region: "WRRA", room: "WRRA_B13",     x:  471, y:  290 },
	{ region: "WARB", room: "WARB_F05",     x: 3590, y:  510 },
	{ region: "WARB", room: "WARB_G26",     x:  490, y: 1000 },
	{ region: "WARB", room: "WARB_F16",     x:  860, y:  285 },
	{ region: "WSKD", room: "WSKD_B33",     x: 2543, y: 1000 },
	{ region: "WSKD", room: "WSKD_B09",     x:  610, y:  450 },
	{ region: "WSKD", room: "WSKD_B20",     x: 1650, y:  330 },
	{ region: "WPTA", room: "WPTA_B04",     x:  390, y:  210 },
	{ region: "WPTA", room: "WPTA_C02",     x:  958, y: 2235 },
	{ region: "WPTA", room: "WPTA_B08",     x:   85, y:  290 },
	{ region: "WSKC", room: "WSKC_A12",     x: 1701, y:  430 },
	{ region: "WSKC", room: "WSKC_A08",     x:  131, y:  110 },
	{ region: "WSKC", room: "WSKC_A27",     x:  110, y:  185 },
	{ region: "WSKB", room: "WSKB_N09",     x:  515, y:  510 },
	{ region: "WSKB", room: "WSKB_C11",     x:  480, y:  500 },
	{ region: "WSKB", room: "WSKB_N11",     x:  853, y:   63 },
	{ region: "WARG", room: "WARG_W08",     x:  460, y:  545 },
	{ region: "WARG", room: "WARG_O05_Future", x:  950, y:  285 },
	{ region: "WARG", room: "WARG_G19",     x:  585, y:  490 },
	{ region: "WSKA", room: "WSKA_D15",     x: 1515, y:  830 },
	{ region: "WSKA", room: "WSKA_D20",     x:  355, y:  530 },
	{ region: "WSKA", room: "WSKA_D11",     x: 2631, y:  630 },
	{ region: "WTDA", room: "WTDA_B08",     x: 6791, y:  470 },
	{ region: "WTDA", room: "WTDA_Z16",     x: 3759, y:  308 },
	{ region: "WTDA", room: "WTDA_Z01",     x: 1650, y:  625 },
	{ region: "WRFB", room: "WRFB_B01",     x:  489, y:  110 },
	{ region: "WRFB", room: "WRFB_D01",     x:  900, y:  191 },
	{ region: "WRFB", room: "WRFB_F04",     x:  610, y:    5 },
	{ region: "WVWA", room: "WVWA_B08",     x:  950, y:   -7 },
	{ region: "WVWA", room: "WVWA_B06",     x:  702, y:  490 },
	{ region: "WVWA", room: "WVWA_B10",     x: 1443, y:  170 },
	{ region: "WARA", room: "WARA_P09",     x:  311, y: 2170 },
	{ region: "WARA", room: "WARA_P21",     x: 1350, y:   90 },
	{ region: "WARA", room: "WARA_P06",     x:  430, y:  155 },
	{ region: "WAUA", room: "WAUA_A03B",    x:  491, y:  420 },
	{ region: "WAUA", room: "WAUA_SHOP",    x: 1020, y:  450 },
	{ region: "WAUA", room: "WAUA_E02",     x: 1450, y:  320 }
];

/**
 *	Known Vista Point locations, to drop into goal strings.
 *	Used by BingoVistaExChallenge enum bin-to-string (formatter "vista_code").
 *	Of the form: "{0}><System.String|{1}|Room|0|vista><{2}><{3}", where {0} is
 *	the region code, {1} is the room name, {2} is the x-coordinate, and {3} the
 *	y-coordinate.
 *	Preloaded from BingoEnum_VistaPoints[] on startup; see addVistaPointsToCode().
 */
const BingoEnum_VistaPoints_Code = [];

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
	"creatures":      ["Any Creature"].concat(Object.keys(creatureNameToDisplayTextMap)),
	"items":          Object.keys(itemNameToDisplayTextMap),
	"pearls":         DataPearlList.slice(2),
	"depths":         BingoEnum_Depthable,
	"expobject":      BingoEnum_expobject,
	"craft":          BingoEnum_CraftableItems,
	"banitem":        BingoEnum_Bannable,
	"food":           BingoEnum_FoodTypes,
	"theft":          BingoEnum_theft,
	"friend":         BingoEnum_Befriendable,
	"transport":      BingoEnum_Transportable,
	"tolls":          BingoEnum_BombableOutposts,
	"pinnable":       BingoEnum_Pinnable,
	"weapons":        BingoEnum_Weapons,
	"weaponsnojelly": BingoEnum_Weapons,
	"regions":        BingoEnum_AllRegionCodes,
	"regionsreal":    BingoEnum_AllRegionCodes,
	"subregions":     BingoEnum_AllSubregions,
	"echoes":         BingoEnum_AllRegionCodes,
	"unlocks":        BingoEnum_AllUnlocks,
	"passage":        Object.keys(passageToDisplayNameMap),
	"characters":     BingoEnum_CHARACTERS,
	"EXPFLAGS":       Object.keys(BingoEnum_EXPFLAGS),
	"challenges":     BingoEnum_CHALLENGES,
	"boolean":        BingoEnum_Boolean,
	"vista_code":     BingoEnum_VistaPoints_Code,
	"chatlogs":       BingoEnum_Chatlogs,
	"tolls_bombed":   BingoEnum_BombedDict,
	"iterators":      BingoEnum_Iterators
};

/**
 *	Instructions for producing text goals.  Index with BingoEnum_CHALLENGES.
 *
 *	An entry shall have this structure:
 *	{
 *		name: "BingoNameOfTheChallenge",
 *		params: [],
 *		desc: "format{2}string {0} with templates {2} for param values {1}"
 *	}
 *
 *	name will generally be of the form /Bingo.*Challenge/, following the
 *	BingoChallenge class the goals inherit from.
 *
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
 *	Alternative formatters are possible by specifying altthreshold, a numeric threshold
 *	at which the alternative will be chosen, and altformatter, the name of the alternative
 *	enum.
 *
 *	Special note: because zero may be used for string terminator, and because enums may be
 *	used for both string (array) and scalar (number) data, the actual enum index written is
 *	someEnumArray.indexOf("someString") + 1 for both data types.  Enums with a default or
 *	"any" value shall use a default index of 0 (thus stored as 1 in the binary format).
 *
 *	Note that the last string in a goal can be terminated by the goal object itself, saving
 *	a zero terminator.  Ensure that an implementation captures this behavior safely, without
 *	committing read-beyond-bounds or uninitialized memory access.  A recommended approach
 *	is copying the goal into a temporary buffer, that has been zeroed at least some bytes
 *	beyond the length of the goal being read.  Or use a language which returns zero or null
 *	or throws error for OoB reads.
 */
const BINARY_TO_STRING_DEFINITIONS = [
	{	//	Base class: no parameters, any desc allowed
		name: "BingoChallenge",
		params: [
			{ type: "string", offset: 0, size: 0, formatter: "" }	//	0: Unformatted string
		],
		desc: "{0}><"
	},
	{
		name: "BingoAchievementChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "passage" }	//	0: Passage choice
		],
		desc: "System.String|{0}|Passage|0|passage><0><0"
	},
	{
		name: "BingoAllRegionsExcept",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "regionsreal" },	//	0: Excluded region choice
			{ type: "number", offset: 1, size: 1, formatter: ""            },	//	1: Remaining region count
			{ type: "string", offset: 2, size: 0, formatter: "regionsreal", joiner: "|" } 	//	2: Remaining regions list
		],
		desc: "System.String|{0}|Region|0|regionsreal><{2}><0><System.Int32|{1}|Amount|1|NULL><0><0"
	},
	{
		name: "BingoBombTollChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "tolls"   },	//	0: Toll choice
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean" } 	//	1: Pass Toll flag
		],
		desc: "System.String|{0}|Scavenger Toll|1|tolls><System.Boolean|{1}|Pass the Toll|0|NULL><0><0"
	},
	{
		name: "BingoCollectPearlChallenge",
		params: [
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean" },	//	0: Specific Pearl flag
			{ type: "number", offset: 0, size: 1, formatter: "pearls"  },	//	1: Pearl choice
			{ type: "number", offset: 1, size: 2, formatter: ""        } 	//	2: Item amount
		],
		desc: "System.Boolean|{0}|Specific Pearl|0|NULL><System.String|{1}|Pearl|1|pearls><0><System.Int32|{2}|Amount|3|NULL><0><0><"
	},
	{
		name: "BingoCraftChallenge",
		params: [
			{ type: "number", offset: 0,  size: 1, formatter: "craft" },	//	0: Item choice
			{ type: "number", offset: 1,  size: 2, formatter: ""      } 	//	1: Item amount
		],
		desc: "System.String|{0}|Item to Craft|0|craft><System.Int32|{1}|Amount|1|NULL><0><0><0"
	},
	{
		name: "BingoCreatureGateChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "transport", altthreshold: 64, altformatter: "creatures" },	//	0: Creature choice
			{ type: "number", offset: 1, size: 1, formatter: "" } 	//	1: Gate amount
		],
		desc: "System.String|{0}|Creature Type|1|transport><0><System.Int32|{1}|Amount|0|NULL><empty><0><0"
	},
	{
		name: "BingoCycleScoreChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Score amount
		],
		desc: "System.Int32|{0}|Target Score|0|NULL><0><0"
	},
	{
		name: "BingoDamageChallenge",
		params: [
			{ type: "number", offset: 0,  size: 1, formatter: "weapons"   },	//	0: Item choice
			{ type: "number", offset: 1,  size: 1, formatter: "creatures" },	//	1: Creature choice
			{ type: "number", offset: 2,  size: 2, formatter: ""          } 	//	2: Score amount
		],
		desc: "System.String|{0}|Weapon|0|weapons><System.String|{1}|Creature Type|1|creatures><0><System.Int32|{2}|Amount|2|NULL><0><0"
	},
	{
		name: "BingoDepthsChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "depths", altthreshold: 64, altformatter: "creatures" }	//	0: Creature choice
		],
		desc: "System.String|{0}|Creature Type|0|depths><0><0"
	},
	{
		name: "BingoDodgeLeviathanChallenge",
		params: [
		],
		desc: "0><0"
	},
	{
		name: "BingoDontUseItemChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "banitem" },	//	0: Item choice
			{ type: "bool",   offset: 0,  bit: 4, formatter: ""        },	//	1: Pass Toll flag
			{ type: "bool",   offset: 0,  bit: 5, formatter: ""        } 	//	2: isCreature flag
		],
		desc: "System.String|{0}|Item type|0|banitem><{1}><0><0><{2}"
	},
	{
		name: "BingoEatChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: ""     },	//	0: Item amount
			{ type: "bool",   offset: 0,  bit: 4, formatter: ""     },	//	1: Creature flag
			{ type: "number", offset: 2, size: 1, formatter: "food" } 	//	2: Item choice
		],
		desc: "System.Int32|{0}|Amount|1|NULL><0><{1}><System.String|{2}|Food type|0|food><0><0"
	},
	{
		name: "BingoEchoChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "echoes"  },	//	0: Echo choice
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean" } 	//	1: Starving flag
		],
		desc: "System.String|{0}|Region|0|echoes><System.Boolean|{1}|While Starving|1|NULL><0><0"
	},
	{
		name: "BingoEnterRegionChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "regionsreal" }	//	0: Region choice
		],
		desc: "System.String|{0}|Region|0|regionsreal><0><0"
	},
	{
		name: "BingoGlobalScoreChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Score amount
		],
		desc: "0><System.Int32|{0}|Target Score|0|NULL><0><0"
	},
	{
		name: "BingoGreenNeuronChallenge",
		params: [
			{ type: "bool", offset: 0, bit: 4, formatter: "boolean" }	//	0: Moon flag
		],
		desc: "System.Boolean|{0}|Looks to the Moon|0|NULL><0><0"
	},
	{
		name: "BingoHatchNoodleChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: ""        },	//	0: Hatch amount
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean" } 	//	1: At Once flag
		],
		desc: "0><System.Int32|{0}|Amount|1|NULL><System.Boolean|{1}|At Once|0|NULL><0><0"
	},
	{
		name: "BingoHellChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "" }	//	0: Squares amount
		],
		desc: "0><System.Int32|{0}|Amount|0|NULL><0><0"
	},
	{
		name: "BingoItemHoardChallenge",
		params: [
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean"   },	//	0: Any shelter flag (added v1.092)
			{ type: "number", offset: 0, size: 1, formatter: ""          },	//	1: Item amount
			{ type: "number", offset: 1, size: 1, formatter: "expobject" } 	//	2: Item choice
		],
		desc: "System.Boolean|{0}|Any Shelter|2|NULL><0><System.Int32|{1}|Amount|0|NULL><System.String|{2}|Item|1|expobject><0><0><"
	},
	{
		name: "BingoKarmaFlowerChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Item amount
		],
		desc: "0><System.Int32|{0}|Amount|0|NULL><0><0"
	},
	{
		name: "BingoKillChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "creatures"      },	//	0: Creature choice
			{ type: "number", offset: 1, size: 1, formatter: "weaponsnojelly" },	//	1: Item choice
			{ type: "number", offset: 2, size: 2, formatter: ""               },	//	2: Kill amount
			{ type: "number", offset: 4, size: 1, formatter: "regions"        },	//	3: Region choice
			//	Note: Subregion choice is still here at offset 5, but unread
			{ type: "bool", offset: 0, bit: 4, formatter: "boolean" },	//	4: One Cycle flag
			{ type: "bool", offset: 0, bit: 5, formatter: "boolean" },	//	5: Death Pit flag
			{ type: "bool", offset: 0, bit: 6, formatter: "boolean" },	//	6: Starving flag
			{ type: "bool", offset: 0, bit: 7, formatter: "boolean" } 	//	7: Mushroom flag
		],
		desc: "System.String|{0}|Creature Type|0|creatures><System.String|{1}|Weapon Used|6|weaponsnojelly><System.Int32|{2}|Amount|1|NULL><0><System.String|{3}|Region|5|regions><System.Boolean|{4}|In one Cycle|3|NULL><System.Boolean|{5}|Via a Death Pit|7|NULL><System.Boolean|{6}|While Starving|2|NULL><System.Boolean|{7}|While under mushroom effect|8|NULL><0><0",
	},
	{
		name: "BingoMaulTypesChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "" }	//	0: Item amount (maybe skimping on number size, but it's basically limited to ALL_ENUMS["creatures"])
		],
		desc: "0><System.Int32|{0}|Amount|0|NULL><0><0><"
	},
	{
		name: "BingoMaulXChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Item amount
		],
		desc: "0><System.Int32|{0}|Amount|0|NULL><0><0"
	},
	{
		name: "BingoNeuronDeliveryChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Item amount
		],
		desc: "System.Int32|{0}|Amount of Neurons|0|NULL><0><0><0"
	},
	{
		name: "BingoNoNeedleTradingChallenge",
		params: [
		],
		desc: "0><0"
	},
	{
		name: "BingoNoRegionChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "regionsreal" }	//	0: Region choice
		],
		desc: "System.String|{0}|Region|0|regionsreal><0><0"
	},
	{
		name: "BingoPearlDeliveryChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "regions" }	//	0: Region choice
		],
		desc: "System.String|{0}|Pearl from Region|0|regions><0><0"
	},
	{
		name: "BingoPearlHoardChallenge",
		params: [
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean" },	//	0: Common Pearls flag
			{ type: "bool",   offset: 0,  bit: 5, formatter: "boolean" },	//	1: Any Shelter flag
			{ type: "number", offset: 0, size: 2, formatter: ""        },	//	2: Pearl amount
			{ type: "number", offset: 2, size: 1, formatter: "regions" } 	//	3: Region choice
		],
		desc: "System.Boolean|{0}|Common Pearls|0|NULL><System.Boolean|{1}|Any Shelter|2|NULL><0><System.Int32|{2}|Amount|1|NULL><System.String|{3}|Region|3|regions><0><0><"
	},
	{
		name: "BingoPinChallenge",
		params: [
			{ type: "number", offset: 0,  size: 2, formatter: ""          },	//	0: Pin amount
			{ type: "number", offset: 2,  size: 1, formatter: "creatures" },	//	1: Creature choice
			{ type: "number", offset: 3,  size: 1, formatter: "regions"   } 	//	2: Region choice
		],
		desc: "0><System.Int32|{0}|Amount|0|NULL><System.String|{1}|Creature Type|1|creatures><><System.String|{2}|Region|2|regions><0><0"
	},
	{
		name: "BingoPopcornChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: "" },	//	0: Item amount
		],
		desc: "0><System.Int32|{0}|Amount|0|NULL><0><0"
	},
	{
		name: "BingoRivCellChallenge",
		params: [
		],
		desc: "0><0"
	},
	{
		name: "BingoSaintDeliveryChallenge",
		params: [
		],
		desc: "0><0"
	},
	{
		name: "BingoSaintPopcornChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Item amount
		],
		desc: "0><System.Int32|{0}|Amount|0|NULL><0><0"
	},
	{
		name: "BingoStealChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "theft"   },	//	0: Item choice
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean" },	//	1: From Toll flag
			{ type: "number", offset: 1, size: 2, formatter: ""        } 	//	2: Steal amount
		],
		desc: "System.String|{0}|Item|1|theft><System.Boolean|{1}|From Scavenger Toll|0|NULL><0><System.Int32|{2}|Amount|2|NULL><0><0"
	},
	{
		name: "BingoTameChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "friend" }	//	0: Creature choice
		],
		desc: "System.String|{0}|Creature Type|0|friend><0><0"
	},
	{
		name: "BingoTradeChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Trade points amount
		],
		desc: "0><System.Int32|{0}|Value|0|NULL><0><0"
	},
	{
		name: "BingoTradeTradedChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Trade item amount (65k is a preposterous amount of trade to allow, but... just in case?)
		],
		desc: "0><System.Int32|{0}|Amount of Items|0|NULL><empty><0><0"
	},
	{
		name: "BingoTransportChallenge",
		params: [
			{ type: "number", offset: 0,  size: 1, formatter: "regions"   },	//	0: From Region choice
			{ type: "number", offset: 1,  size: 1, formatter: "regions"   },	//	1: To Region choice
			{ type: "number", offset: 2,  size: 1, formatter: "transport", altthreshold: 64, altformatter: "creatures" } 	//	2: Creature choice
		],
		desc: "System.String|{0}|From Region|0|regions><System.String|{1}|To Region|1|regions><System.String|{2}|Creature Type|2|transport><><0><0"
	},
	{
		name: "BingoUnlockChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: "unlocks" }	//	0: Unlock token choice (bigger than needed, but future-proofing as it's a pretty big list already?...)
		],
		desc: "System.String|{0}|Unlock|0|unlocks><0><0"
	},
	{
		name: "BingoVistaChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "regions"        },	//	0: Region choice
			{ type: "string", offset: 5, size: 0, formatter: "", joiner: ""   },	//	1: Room name (verbatim) (read to zero terminator or end of goal)
			{ type: "number", offset: 1, size: 2, signed: true, formatter: "" },	//	2: Room X coordinate (decimal)
			{ type: "number", offset: 3, size: 2, signed: true, formatter: "" } 	//	3: Room Y coordinate (decimal)
		],
		desc: "{0}><System.String|{1}|Room|0|vista><{2}><{3}><0><0"
	},
	{	//  Alternate enum version for as-generated locations
		name: "BingoVistaExChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "vista_code" } 	//	0: Vista Point choice
		],
		desc: "{0}><0><0"
	},
	{	//	added v0.86
		name: "BingoEnterRegionFromChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "regionsreal" },	//	0: From regions choice
			{ type: "number", offset: 1, size: 1, formatter: "regionsreal" } 	//	1: To regions choice
		],
		desc: "System.String|{0}|From|0|regionsreal><System.String|{1}|To|0|regionsreal><0><0"
	},
	{
		name: "BingoMoonCloakChallenge",
		params: [
			{ type: "bool", offset: 0, bit: 4, formatter: "boolean" }	//	0: Delivery choice
		],
		desc: "System.Boolean|{0}|Deliver|0|NULL><0><0"
	},
	{	//	added v1.09
		name: "BingoBroadcastChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "chatlogs" }	//	0: Chatlog selection
		],
		desc: "System.String|{0}|Broadcast|0|chatlogs><0><0"
	},
	{	//	added v1.092
		name: "BingoDamageExChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "weapons"    },	//	0: Weapon choice
			{ type: "number", offset: 1, size: 1, formatter: "creatures"  },	//	1: Creature choice
			{ type: "number", offset: 2, size: 2, formatter: ""           },	//	2: Hits amount
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean"    },	//	3: One Cycle flag
			{ type: "number", offset: 4, size: 1, formatter: "regions"    },	//	4: Region choice
			{ type: "number", offset: 5, size: 1, formatter: "subregions" } 	//	5: Subregion choice
		],
		desc: "System.String|{0}|Weapon|0|weapons><System.String|{1}|Creature Type|1|creatures><0><System.Int32|{2}|Amount|2|NULL><System.Boolean|{3}|In One Cycle|0|NULL><System.String|{4}|Region|5|regions><System.String|{5}|Subregion|4|subregions><0><0"
	},
	{
		name: "BingoTameExChallenge",
		params: [
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean" },	//	0: Specific flag
			{ type: "number", offset: 0, size: 1, formatter: "friend"  },	//	1: Creature choice
			{ type: "number", offset: 1, size: 1, formatter: ""        } 	//	2: Tame amount
		],
		desc: "System.Boolean|{0}|Specific Creature Type|0|NULL><System.String|{1}|Creature Type|0|friend><0><System.Int32|{2}|Amount|3|NULL><0><0><"
	},
	{	//	added v1.2
		name: "BingoBombTollExChallenge",
		params: [
			{ type: "bool",   offset: 0,  bit: 5, formatter: "boolean"      },	//	0: Specific Toll flag
			{ type: "number", offset: 0, size: 1, formatter: "tolls"        },	//	1: Toll choice
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean"      },	//	2: Pass Toll flag
			{ type: "number", offset: 1, size: 1, formatter: ""             },	//	3: Toll amount
			{ type: "string", offset: 2, size: 0, formatter: "tolls_bombed" } 	//	4: `bombed` dictionary
		],
		desc: "System.Boolean|{0}|Specific toll|0|NULL><System.String|{1}|Scavenger Toll|3|tolls><System.Boolean|{2}|Pass the Toll|2|NULL><0><System.Int32|{3}|Amount|1|NULL><empty><0><0"
	},
	{
		name: "BingoEchoExChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "echoes"  },	//	0: Echo choice
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean" },	//	1: Starving flag
			{ type: "number", offset: 1, size: 1, formatter: ""        },	//	2: Echo amount
			{ type: "string", offset: 2, size: 0, formatter: "regions", joiner: "|" }	//	3: Seen list
		],
		desc: "System.Boolean|false|Specific Echo|0|NULL><System.String|{0}|Region|1|echoes><System.Boolean|{1}|While Starving|3|NULL><0><System.Int32|{2}|Amount|2|NULL><0><0><{3}"
	},
	{
		name: "BingoDodgeNootChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Amount
		],
		//	amount, current, completed, revealed
		desc: "System.Int32|{0}|Amount|0|NULL><0><0><0"
	},
	{
		name: "BingoDontKillChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "creatures" }	//	0: Creature choice
		],
		//	victim, completed, revealed
		desc: "System.String|{0}|Creature Type|0|creatures><0><0"
	},
	{
		name: "BingoGourmandCrushChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "" }	//	0: Amount
		],
		//	current, amount, completed, revealed, crushed
		desc: "0><System.Int32|{0}|Amount|0|NULL><0><0><"
	},
	{
		name: "BingoIteratorChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "iterators" }	//	0: Oracle choice
		],
		//	oracle, completed, revealed
		desc: "System.Boolean|{0}|Looks to the Moon|0|NULL><0><0"
	},
	{
		name: "BingoItemHoardExChallenge",
		params: [
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean"   },	//	0: Any shelter flag (added v1.092)
			{ type: "number", offset: 0, size: 1, formatter: ""          },	//	1: Item amount
			{ type: "number", offset: 1, size: 1, formatter: "expobject" },	//	2: Item choice
			{ type: "number", offset: 2, size: 1, formatter: "regions"   } 	//	3: Region choice
		],
		desc: "System.Boolean|{0}|Any Shelter|2|NULL><0><System.Int32|{1}|Amount|0|NULL><System.String|{2}|Item|1|expobject><System.String|{3}|Region|4|regions><0><0><"
	},
	{
		name: "BingoLickChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "" }	//	0: Lick amount
		],
		desc: "0><System.Int32|{0}|Amount|0|NULL><0><0><"
	}
];

/**
 *	Used by binGoalToText(); list of upgraded challenges.
 *	Hacky, but allows legacy BINARY_TO_STRING_DEFINITIONS[] indices to work
 *	as intended, while updating CHALLENGES[].  Each updated challenge adds a
 *	new index to BINARY_TO_STRING_DEFINITIONS[] and a stub function to
 *	CHALLENGES[].
 *	key: new internal name
 *	value: old/external name
 *	[not present]: no change
 */
const ChallengeUpgrades = {
	//	< v0.80
	"BingoVistaExChallenge":     "BingoVistaChallenge",
	//	v1.092
	"BingoDamageExChallenge":    "BingoDamageChallenge",
	"BingoTameExChallenge":      "BingoTameChallenge",
	//	v1.2
	"BingoBombTollExChallenge":  "BingoBombTollChallenge",
	"BingoEchoExChallenge":      "BingoEchoChallenge",
	"BingoItemHoardExChallenge": "BingoItemHoardChallenge"
};


/* * * Utility Functions * * */

/**
 *	Called on startup.  Expands lists with common values/structure into
 *	full lists, to save on static storage.
 *	Validates enums/lists/dictionaries with common keys, that at least
 *	keys map to a real value.
 *	Emits console messages on failure.
 */
function expandAndValidateLists() {
	var a;

	BingoEnum_ArenaUnlocksBlue.forEach(s => BingoEnum_AllUnlocks.push(s));
	BingoEnum_ArenaUnlocksGold.forEach(s => BingoEnum_AllUnlocks.push(s));
	BingoEnum_ArenaUnlocksRed.forEach(s => BingoEnum_AllUnlocks.push(s));
	BingoEnum_ArenaUnlocksGreen.forEach(s => BingoEnum_AllUnlocks.push(s));

	addVistaPointsToCode(BingoEnum_VistaPoints);

	for (var g of BINARY_TO_STRING_DEFINITIONS) {
		BingoEnum_CHALLENGES.push(g.name);
	}
	a = 0; Object.keys(CHALLENGES).forEach(s => { if (BingoEnum_CHALLENGES.indexOf(s) < 0) a++; } );
	if (a > 0) console.log("expandAndValidateLists(): BingoEnum_CHALLENGES[] lacking element(s) from Object.keys(CHALLENGES)");
	a = 0; BingoEnum_CHALLENGES.forEach(s => { if (CHALLENGES[s] === undefined) a++; } );
	if (a > 0) console.log("expandAndValidateLists(): CHALLENGES lacking element(s) from BingoEnum_CHALLENGES[]");

	a = 0; DataPearlList.forEach(s => { if (dataPearlToRegionMap[s] === undefined) a++; } );
	if (a > 0) console.log("expandAndValidateLists(): dataPearlToRegionMap[] lacking element(s) from DataPearlList[]");
	a = 0; DataPearlList.forEach(s => { if (dataPearlToColorMap[s] === undefined) a++; } );
	if (a > 0) console.log("expandAndValidateLists(): dataPearlToColorMap[] lacking element(s) from DataPearlList[]");
	a = 0; DataPearlList.forEach(s => { if (dataPearlToDisplayTextMap[s] === undefined) a++; } );
	if (a > 0) console.log("expandAndValidateLists(): dataPearlToDisplayTextMap[] lacking element(s) from DataPearlList[]");
}

/**
 *	Appends preset goals to BingoEnum_VistaPoints_Code[].
 *	Used on startup with BingoEnum_VistaPoints[].
 *	Potential future mod use.
 */
function addVistaPointsToCode(vistas) {
	for (var v of vistas) {
		BingoEnum_VistaPoints_Code.push(v.region + "><System.String|" + v.room + "|Room|0|vista><" + String(v.x) + "><" + String(v.y));
	}
}

/**
 *	Converts a byte array to a "URL safe" base64 string,
 *	using these substitutions:
 *	'+' -> '-'
 *	'/' -> '_'
 *	'=' -> ''
 */
function binToBase64u(a) {
	var s = btoa(String.fromCharCode.apply(null, a));
	return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
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
 *	Finds the given string, in BINARY_TO_STRING_DEFINITIONS[i].name,
 *	returning the first matching index i, or -1 if not found.
 */
function challengeValue(s) {
	return BINARY_TO_STRING_DEFINITIONS.findIndex(a => a.name === s);
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

/**
 *	Checks descriptor length against given value.  CHALLENGES helper function.
 *	@param t  (String) name of calling challenge
 *	@param d  (Number) desc.length
 *	@param g  (Number) expected length
 *	@throws TypeError on mismatch
 */
function checkDescLen(t, d, g) {
	if (d != g) throw new TypeError(t + ": found " + String(d) + " parameters, expected " + String(g));
}

/**
 *	Check if the specified challenge descriptor SettingBox string matches
 *	the asserted value.  Helper function for CHALLENGES functions.
 *	@param t    string, name of calling object/function
 *	@param d    string to parse and verify (e.g. "System.String|selectedItem|LabelText|itemIndex|list")
 *	@param f    array of values to compare to; length must match, empty elements are ignored
 *	@param err  string, text to include in the error
 *	@throws TypeError if invalid
 */
function checkSettingBox(t, d, f, err) {
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
 *	Check the challenge descriptor part s is a valid SettingBox, matching the specified template.
 *	@param s  string to validate
 *	@param template  object of the form:
 *	{
 *		datatype: "System.Int32",	//	Field type; acceptable values: "System.Boolean", "System.Int32", "System.String"
 *		name: "Amount",   	//	Field label as displayed in the menu
 *		position: "2",    	//	Field position on the menu
 *		formatter: "NULL",	//	Field list name (type System.String: also enum list to check against; Int, Bool: should be "NULL")
 *		altformatter: ""  	//	(type System.String) alternative list to check against; if the value isn't found in either formatter list, an error is returned
 *		altthreshold: 64  	//	(type System.String) base index for the altformatter list
 *		minval: 1,        	//	(type System.Int32) minimum value
 *		maxval: CHAR_MAX, 	//	(type System.Int32) maximum value
 *		defaultval: 1     	//	Default value (returned when a non-fatal error has occurred)
 *	}
 *	@return object of the form:
 *	{
 *		value: <value>,	//	parsed value, of native type: Boolean (true/false), Number (integer, template.minval to template.maxval inclusive), or String
 *		error: [],     	//	list of strings describing what error(s) occurred
 *		index: <Number>	//	(type System.String) index of the item in its formatter list, or altformatter list + altthreshold; -1 if absent or "NULL"
 *	}
 */
function checkSettingBoxEx(s, template) {
	var ar = s.split("|");
	//	number of parameters
	if (ar.length < 5) return { value: template.defaultval, error: ["insufficient parameters"] };
	if (ar.length > 5) return { value: template.defaultval, error: ["excess parameters" ] };
	//	data type
	if (ar[0] !== template.datatype)
		return { value: template.defaultval, error: ["type mismatch"] };
	var rr = { value: template.defaultval, error: [] };
	//	menu parameters
	if (ar[2] !== template.name)
		rr.error.push("name mismatch");
	if (ar[3] !== template.position)
		rr.error.push("position mismatch");
	//	type, and parse the value of that type
	if (ar[0] === "System.Boolean") {
		if (ar[1] === "true")
			rr.value = true;
		else if (ar[1] === "false")
			rr.value = false;
		else {
			rr.error.push("invalid Boolean value; using default");
		}
	} else if (ar[0] === "System.Int32") {
		var num = parseInt(ar[1]);
		if (isNaN(num)) {
			rr.error.push("Int32 value " + ar[1] + " not a number; using default");
		} else if (num > template.maxval) {
			rr.value = template.maxval;
			rr.error.push("Int32 number exceeds maximum");
		} else if (num < template.minval) {
			rr.value = template.minval;
			rr.error.push("Int32 number exceeds minimum");
		} else {
			rr.value = num;
		}
	} else if (ar[0] === "System.String") {
		rr.index = ALL_ENUMS[template.formatter].indexOf(template.defaultval);
		//	validate which kind of string it is
		if (ar[4] !== template.formatter && ar[4] !== template.altformatter) {
			rr.error.push("unexpected list \"" + ar[4] + "\"");
		} else if (template.formatter === "NULL") {
			rr.value = ar[1];	//	raw string
			rr.index = -1;
		} else {
			rr.index = (ALL_ENUMS[template.formatter].indexOf(template.defaultval) >= 0) ? (ALL_ENUMS[template.formatter].indexOf(template.defaultval)) : (ALL_ENUMS[template.altformatter]?.indexOf(template.defaultval) + template.altthreshold);
			idx1 = ALL_ENUMS[template.formatter].indexOf(ar[1]);
			idx2 = ALL_ENUMS[template.altformatter]?.indexOf(ar[1]) || -1;
			if (idx1 < 0 && idx2 < 0) {
				rr.error.push("value not found in list; using default");
			} else {
				rr.value = ar[1];
				rr.index = (idx1 >= 0) ? idx1 : idx2 + template.altthreshold;
			}
		}
	} else {
		rr.error.push("unknown type \"" + ar[0] + "\"");
	}
	if (ar[0] !== "System.String" && ar[4] !== "NULL")
		rr.error.push("list mismatch \"" + ar[4] + "\"");
	return rr;
}

/**
 *	Generate a valid? HTML link to the RW map viewer (from map_link_base),
 *	for the specified character (e.g. board.character value) and room.
 */
function getMapLink(room, chr) {
	if (map_link_base === "")
		return "";
	var reg = regionOfRoom(room);

	//	Replacements from BingoVistaChallenge.cs
	if (room === "GW_E02" && (chr === "Artificer" || chr === "Spearmaster")) room = "GW_E02_PAST";
	if (room === "GW_D01" && (chr === "Artificer" || chr === "Spearmaster")) room = "GW_D01_PAST";
	if (room === "UW_C02" && chr === "Rivulet") room = "UW_C02RIV";
	if (room === "UW_D05" && chr === "Rivulet") room = "UW_D05RIV";

	var ch = Object.keys(BingoEnum_CharToDisplayText)[
			Object.values(BingoEnum_CharToDisplayText).indexOf(chr)
		] || "White";
	ch = ch.toLowerCase();
	return "<br><a href=\"" + map_link_base + "?slugcat=" + ch + "&region=" + reg + "&room="
			+ room + "\" target=\"_blank\">" + room + " on Rain World Downpour Map" + "</a>";
}

/**
 *	Extract region code from given room code string.
 *	All extant regions follow this pattern, so, probably safe enough?
 */
function regionOfRoom(r) {
	return r.substring(0, r.search("_"));
}

/**
 *	Performs version upgrade patching for the given challenge descriptor
 *	and upgrade array.
 *
 *	Assumption: version differences are expressed by varying the number
 *	of parameters in a challenge.  As long as this assumption bears true,
 *	we can identify version by d.length, and make corrections as needed,
 *	adapting old versions to the current-version parser.
 *
 *	@param d  array of strings; challenge descriptor to patch (is modified in place)
 *	@param upg  sparse array specifying upgrade patching:
 *		- upg is indexed by d.length
 *		- if there is no matching entry in upg (upg[d.length] === undefined),
 *		  no action is taken: d is either an acceptable version, or unknown
 *		  (and probably an error)
 *		- When a matching entry exists, it contains a list of steps to apply
 *		  to d to update it to a newer version.  This may be a subsequent
 *		  version, or directly to latest.  Just make sure there is no sequence
 *		  of update steps that would cause it to loop forever(!).
 *		- Expected structure:
 *		upg = {
 *			3: [ {
 *				//	d.splice(offs, rem, ...data)
 *				op: "splice", offs: 2, rem: 0, data: ["insert string 1", "insert string 2"]
 *			} ],
 *			5: [ {
 *				//	d.push(...data)
 *				op: "push", data: ["new last string"]
 *			} ],
 *			6: [ {
 *				//	d.unshift(...data)
 *				op: "unshift", data: ["new first string"]
 *			} ],
 *			7: [ {
 *				//	d[offs] = d[offs].replace(find, replace)
 *				op: "replace", offs: 4, find: "insert string", replace: "added text"
 *			} ]
 *		};
 *		Executing upg on d = ["foo", "bar", "baz"] gives the result:
 *		["new first string", "foo", "bar", "insert string 1", "added text 2", "baz", "new last string"]
 *	@return d is modified in place; it's also returned for convenience
 */
function upgradeDescriptor(d, upg) {
	var iterations = 0;
	do {
		var l = d.length;
		if (upg[l] === undefined) {
			break;
		} else {
			for (var i = 0; i < upg[l].length; i++) {
				var step = upg[l][i];
				if (step.op === "splice") {
					d.splice(step.offs, step.rem, ...step.data);
				} else if (step.op === "push") {
					d.push(step.data);
				} else if (step.op === "unshift") {
					d.unshift(step.data);
				} else if (step.op === "replace") {
					d[step.offs] = d[step.offs].replace(step.find, step.replace);
				} else if (step.op === "intFormat") {
					//	used by BingoAllRegionsExcept v0.85
					if (!isNaN(parseInt(d[step.offs])))
						d[step.offs] = step.before + String(parseInt(d[step.offs])) + step.after;
				} else {
					console.log(thisname + ": unsupported upgrade operation: " + upg[l][i].op);
				}
			}
		}
		iterations++;
	} while (d.length != l && iterations < 1000);
	if (iterations >= 1000) console.log("upgradeDescriptor(): infinite loop detected.");
	return d;
}

/**
 *	Parses a text-format challenge parameter list, according to the
 *	specified parameter template.
 *	@param desc      parameter list / descriptor; (plain text).split("><")
 *	@param template  array of the form:
 *	[
 *		{ param: "setting1", type: "string", formatter: "enum1",
 *				parse: "SettingBox", parseFmt: (*) },
 *		{ param: "number2",  type: "number", formatter: "",
 *				parse: "parseInt", defaultval: 0 },
 *		{ param: "list3",    type: "list",   formatter: "enum2",
 *				parse: "list", separator: "|", defaultval: "" }
 *		{ param: "dict4",    type: "list",   formatter: "",
 *				parse: "list", separator: "%", defaultval: "empty" }
 *	]
 *	Each descriptor element is processed pairwise with each template
 *	element in order; thus .split("><").length == template.length.
 *
 *	Some template properties are common:
 *		param     	string, name of property this parameter will be assigned to
 *		          	(and similarly in ._error and ._templates)
 *		type      	string, primitive type assigned to [param]; one of "bool",
 *		          	"number", "string", "list"; used to read/format parameters
 *		          	after creation ("list" type is only used for an array of
 *		          	string elements, keyed from formatter)
 *		formatter 	string, name of enum list (in ALL_ENUMS) to select from
 *		          	(string type)
 *		parse     	parser used to extract the value; one of "parseInt",
 *		          	"SettingBox", "list"
 *		defaultval	default value (of native type) stored in param if text
 *		          	cannot be parsed, or for initialization
 *		minval    	int: minimum clamping value; list: if less than this many
 *		          	elements, use defaultval instead
 *		maxval    	maximum clamping value of int type
 *	additional properties depend on type:
 *		parseFmt 	for SettingBox parser; object is passed to checkSettingBoxEx()
 *		         	(see its comment for more information)
 *		separator 	for list parser; delimiter string (i.e., .split(separator))
 *
 *	@return Object of the form:
 *	{
 *		[...param...]: <properties with native type>,
 *		_error: {
 *			[...param...]: ["list of error strings"]
 *		},
 *		_templates: {
 *			[...param...]: (reference to template that produced the param)
 *		}
 *	}
 */
//function challengeTextToAbstract(s, template) {
//	var desc = s.split("><");
function challengeTextToAbstract(desc, template) {
	if (desc.length != template.length) throw new TypeError("found " + desc.length + " parameters, expected " + template.length);
	var params = { _error: {}, _templates: {} };
	for (var i = 0; i < template.length; i++) {
		params[template[i].param] = template[i].defaultval;
		params._error[template[i].param] = [];
		params._templates[template[i].param] = template[i];
		if (template[i].parse === "parseInt") {
			var tmp = parseInt(desc[i]);
			if (isNaN(tmp)) {
				params._error[template[i].param].push("not a number; using default");
			} else {
				if (tmp > template[i].maxval) {
					params[template[i].param] = template[i].maxval;
					params._error[template[i].param].push("number exceeds maximum");
				} else if (tmp < template[i].minval) {
					params[template[i].param] = template[i].minval;
					params._error[template[i].param].push("number exceeds minimum");
				} else {
					params[template[i].param] = tmp;
				}
			}
		} else if (template[i].parse === "SettingBox") {
			var tmp = checkSettingBoxEx(desc[i], template[i].parseFmt);
			params[template[i].param] = tmp.value;
			params._error[template[i].param].splice(-1, 0, ...tmp.error);
		} else if (template[i].parse === "list") {
			var tmp = desc[i].split(template[i].separator);
			params[template[i].param] = [];
			tmp.forEach(s => {
				if (enumToValue(s, template[i].formatter) == 0)
					params._error[template[i].param].push(s + " not found in enum, ignoring");
				else
					params[template[i].param].push(s);
			});
			if (params[template[i].param].length < template[i].minval) {
				params[template[i].param] = [template[i].defaultval];
				params._error[template[i].param].push("count less than minimum; using default");
			}
		} else {
			console.log("unsupported parse operation: " + template[i].parse);
		}
	}
	return params;
}

/**
 *	Default: for n != 1, concatenates number, space, name.
 *	For n == 1, tests for special cases (ref: creatureNameToDisplayTextMap,
 *	itemNameToDisplayTextMap), converting it to the English singular case
 *	("a Batfly", etc.).
 */
function entityNameQuantify(n, s) {
	if (n != 1)
		return String(n) + " " + s;
	s = s.replace(/Mice$/, "Mouse").replace(/ies$/, "y").replace(/ches$/, "ch").replace(/s$/, "");
	if (/^[AEIOU]/i.test(s))
		s = "an " + s;
	else
		s = "a " + s;
	return s;
}

function entityDisplayText(e) {
	return creatureNameToDisplayTextMap[e] || itemNameToDisplayTextMap[e] || e;
}

function entityIconAtlas(e) {
	return creatureNameToIconAtlasMap[e] || itemNameToIconAtlasMap[e] || e;
}

function entityIconColor(e) {
	return creatureNameToIconColorMap[e] || itemNameToIconColorMap[e] || creatureNameToIconColorMap["Default"];
}

/**
 *	Converts sub/region names to their display text, as appropriate for
 *	the selected character.
 *	@param ch      character name (from Object.values(BingoEnum_CharToDisplayText)),
 *	               or "Any" to emit both normal and Saint names when available.
 *	@param reg     region code (from Object.keys(regionCodeToDisplayName)),
 *	               or "Any Region" to disable
 *	@param subreg  subregion name (from BingoEnum_AllSubregions), or "Any Subregion"
 *	               to disable
 *	@return String, display text
 */
function regionToDisplayText(ch, reg, subreg) {
	if (Object.values(BingoEnum_CharToDisplayText).indexOf(ch) < 0 || ch === "Nightcat") ch = "Any";
	var s = "";
	if (subreg !== "Any Subregion") {
		s = subreg;
	} else if (reg !== "Any Region") {
		if (regionCodeToDisplayName[reg] !== undefined && regionCodeToDisplayNameSaint[reg] !== undefined) {
			if (ch === "Any")
				s = regionCodeToDisplayName[reg] + " / " + regionCodeToDisplayNameSaint[reg];
			else if (ch === "Saint")
				s = regionCodeToDisplayNameSaint[reg];
			else
				s = regionCodeToDisplayName[reg];
		} else {
			s = regionCodeToDisplayName[reg] || regionCodeToDisplayNameSaint[reg] || reg;
		}
	}
	return s;
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
 *	@param comm       String to set as comment / title
 *	@param character  Selected character; one of Object.values(BingoEnum_CharToDisplayText),
 *	                  or "Any" if other
 *	@param shelter    Shelter to start in, or "" if random
 *	@param perks      List of perks to enable.  Array of integers, each indexing
 *	                  ALL_ENUMS.EXPFLAGS[] and respective enums (see also
 *	                  BingoEnum_EXPFLAGSNames). For example, the list [0, 5, 13, 14, 16]
 *	                  would enable: "Perk: Scavenger Lantern", "Perk: Karma Flower", "Perk:
 *	                  Item Crafting", "Perk: High Agility", "Burden: Blinded" (ordering of
 *	                  this array is not checked, and repeats are ignored)
 *	Parameters are optional; an absent parameter leaves the existing value alone.
 *	Call with no parameters to see usage.
 */
function setMeta() {
	var comm = arguments[0], character = arguments[1];
	var shelter = arguments[2], perks = arguments[3];

	if (board === undefined || document.getElementById("hdrttl") === null
			|| document.getElementById("hdrchar") === null
			|| document.getElementById("hdrshel") === null) {
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
		parseButton();
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

function enumeratePerks() {
	var a = [];
	for (var i = 0, el; i < Object.values(BingoEnum_EXPFLAGS).length; i++) {
		el = document.getElementById("perkscheck" + String(i));
		if (el !== null) {
			if (el.checked)
				a.push(i);
		} else
			break;
	}
	return a;
}

function compressionRatio() {
	return Math.round(1000 - 1000 * board.toBin.length / document.getElementById("textbox").value.length) / 10;
}

/**	approx. room count in Downpour, adding up Wiki region room counts */
const TOTAL_ROOM_COUNT = 1578;

/**
 *	Counts the total number of possible values/options for a given goal
 *	type (g indexing in BINARY_TO_STRING_DEFINITIONS).
 *
 *	TODO: bring in patches from below
 */
function countGoalOptions(g) {
	g = parseInt(g);
	var count = 1;
	if (g < 0 || g >= BINARY_TO_STRING_DEFINITIONS.length) return;
	var desc = BINARY_TO_STRING_DEFINITIONS[g];
	for (var i = 0; i < desc.params.length; i++) {
		if (desc.params[i].type === "bool") {
			count *= 2;
		} else if (desc.params[i].type === "number") {
			if (desc.params[i].formatter === "") {
				if (desc.params[i].size == 1) {
					//	Known uses: desc.name in ["BingoAllRegionsExcept", "BingoHatchNoodleChallenge", "BingoHellChallenge", "BingoItemHoardChallenge"]
					count *= CHAR_MAX + 1;
				} else if (desc.params[i].size == 2) {
					count *= INT_MAX + 1;
				} else {
					console.log("Unexpected value: BINARY_TO_STRING_DEFINITIONS["
							+ g + "].params[" + i + "].size: " + desc.params[i].size);
				}
			} else {
				if (ALL_ENUMS[desc.params[i].formatter] === undefined) {
					console.log("Unexpected formatter: BINARY_TO_STRING_DEFINITIONS["
							+ g + "].params[" + i + "].formatter: " + desc.params[i].formatter);
				} else {
					count *= ALL_ENUMS[desc.params[i].formatter].length;
				}
			}
		} else if (desc.params[i].type === "string" || desc.params[i].type === "pstr") {
			var exponent = desc.params[i].size;
			if (exponent == 0) {
				//	Known uses: desc.name in ["BingoChallenge", "BingoAllRegionsExcept", "BingoVistaChallenge"]
				//	Variable length; customize based on goal
				if (desc.name === "BingoChallenge" && i == 0) {
					//	Plain (UTF-8) string
					exponent = 0;
				} else if (desc.name === "BingoAllRegionsExcept" && i == 2) {
					//	Can assign arbitrary sets of regions here; usually, set to everything but the target region so 0 degrees of freedom
					exponent = 0;
				} else if (desc.name === "BingoVistaChallenge" && i == 1) {
					//	String selects room name
					exponent = 0;
					count *= TOTAL_ROOM_COUNT;	//	approx. room count in Downpour, adding up Wiki region room counts
				}
			}
			if (desc.params[i].formatter === "") {
				for (var j = 0; j < exponent; j++)
					count *= 256;
			} else if (ALL_ENUMS[desc.params[i].formatter] === undefined) {
				console.log("Unexpected formatter: BINARY_TO_STRING_DEFINITIONS["
						+ g + "].params[" + i + "].formatter: " + desc.params[i].formatter);
			} else {
				for (var j = 0; j < exponent; j++)
					count *= ALL_ENUMS[desc.params[i].formatter].length - 1;
			}
		} else {
			console.log("Unsupported type: BINARY_TO_STRING_DEFINITIONS["
					+ g + "].params[" + i + "].type: " + desc.params[i].type);
		}
	}

	return count;
}

/**
 *	Use binGoalToText(goalFromNumber(g, Math.random())) to generate truly
 *	random goals.
 *	Warning, may be self-inconsistent (let alone with others on a board!).
 *	@param g goal index (in BINARY_TO_STRING_DEFINITIONS[]) to generate.
 *	@param n floating point value between 0...1; arithmetic encoded sequence
 *	of parameters.
 */ 
function goalFromNumber(g, n) {
	g = parseInt(g);
	if (g < 0 || g >= BINARY_TO_STRING_DEFINITIONS.length) return;
	n = parseFloat(n);
	if (isNaN(n) || n < 0 || n >= 1) return;
	var r = new Uint8Array(256);
	var bytes = 0;
	var val;
	var desc = BINARY_TO_STRING_DEFINITIONS[g];
	r[0] = g;
	for (var i = 0; i < desc.params.length; i++) {
		if (desc.params[i].type === "bool") {
			n *= 2;
			val = Math.floor(n);
			n -= val;
			r[1 + desc.params[i].offset] |= (val << desc.params[i].bit);
			bytes = Math.max(bytes, desc.params[i].offset - 1);
		} else if (desc.params[i].type === "number") {
			val = 0;
			if (desc.name === "BingoMaulTypesChallenge") {
				n *= ALL_ENUMS["creatures"].length + 1;
			} else if (desc.params[i].formatter === "regionsreal" ||
			           desc.params[i].formatter === "echoes") {
				n *= ALL_ENUMS[desc.params[i].formatter].length - 1;
				val = 2;	//	exclude "Any Region" option
			} else if (desc.params[i].formatter === "") {
				val = 1;	//	no use-cases for zero amount
				if (desc.params[i].size == 1) {
					n *= CHAR_MAX;
				} else if (desc.params[i].size == 2) {
					n *= INT_MAX;
				} else {
					console.log("Unexpected value: BINARY_TO_STRING_DEFINITIONS["
							+ g + "].params[" + i + "].size: " + desc.params[i].size);
				}
			} else if (ALL_ENUMS[desc.params[i].formatter] === undefined) {
				console.log("Unexpected formatter: BINARY_TO_STRING_DEFINITIONS["
						+ g + "].params[" + i + "].formatter: " + desc.params[i].formatter);
			} else {
				n *= ALL_ENUMS[desc.params[i].formatter].length;
				val = 1;
			}
			val += Math.floor(n);
			n -= Math.floor(n);
			if (desc.params[i].size == 1) {
				r[GOAL_LENGTH + desc.params[i].offset] = val;
			} else if (desc.params[i].size == 2) {
				applyShort(r, GOAL_LENGTH + desc.params[i].offset, val);
			} else {
				//	add more apply-ers here
			}
			bytes = Math.max(bytes, desc.params[i].offset + desc.params[i].size);
		} else if (desc.params[i].type === "string") {
			if (desc.params[i].size == 0) {
				//	Known uses: desc.name in ["BingoChallenge", "BingoAllRegionsExcept", "BingoVistaChallenge", "BingoBombTollExChallenge", BingoEchoExChallenge"]
				//	Variable length; customize based on goal
				if (desc.name === "BingoChallenge" && i == 0) {
					//	Plain (UTF-8) string, any length
					val = "Title Text!";
					val = new TextEncoder().encode(val);
				} else if (desc.name === "BingoAllRegionsExcept" && i == 2) {
					//	Can assign an arbitrary set of regions here
					//	usually is set to all regions (0 degrees of freedom)
					val = Array(ALL_ENUMS[desc.params[i].formatter].length);
					for (var j = 0; j < val.length - 1; j++) val[j] = j + 2;
				} else if (desc.name === "BingoVistaChallenge" && i == 1) {
					//	String selects room name; don't have a list of these, use a descriptive identifier instead
					n *= TOTAL_ROOM_COUNT;
					val = Math.floor(n);
					n -= val;
					val = "room_" + String(val);
					val = new TextEncoder().encode(val);
				} else if (desc.name === "BingoBombTollExChallenge" || desc.name === "BingoEchoExChallenge") {
					//	list of bombed tolls or visited echoes; default empty
					val = [];
				} else {
					console.log("Unknown use of type \"string\", size = 0, in " +
							"BINARY_TO_STRING_DEFINITIONS[" + g + "].params[" + i + "]");
				}
				for (var j = 0; j < val.length; j++)
					r[GOAL_LENGTH + desc.params[i].offset + j] = val[j];
				bytes = Math.max(bytes, desc.params[i].offset + val.length);
			} else {
				val = Array(desc.params[i].size);
				bytes = Math.max(bytes, desc.params[i].offset + desc.params[i].size);
				if (ALL_ENUMS[desc.params[i].formatter] !== "" &&
						ALL_ENUMS[desc.params[i].formatter] === undefined) {
					console.log("Unexpected formatter: BINARY_TO_STRING_DEFINITIONS["
							+ g + "].params[" + i + "].formatter: " + desc.params[i].formatter);
				} else {
					for (var j = 0; j < desc.params[i].size; j++) {
						if (ALL_ENUMS[desc.params[i].formatter] === "") {
							n *= 256;
						} else {
							n *= ALL_ENUMS[desc.params[i].formatter].length;
						}
						val = Math.floor(n);
						n -= val;
						r[GOAL_LENGTH + desc.params[i].offset + j] = val;
						if (ALL_ENUMS[desc.params[i].formatter] > "")
							r[GOAL_LENGTH + desc.params[i].offset + j]++;
					}
				}
			}
		} else if (desc.params[i].type === "pstr") {
			console.log("Unimplemented type: \"pstr\" in " |
					"BINARY_TO_STRING_DEFINITIONS[" + g + "].params[" + i + "]");
		} else {
			console.log("Unsupported type: BINARY_TO_STRING_DEFINITIONS["
					+ g + "].params[" + i + "].type: " + desc.params[i].type);
		}
	}
	r[2] = bytes;

	return r.subarray(0, bytes + GOAL_LENGTH);
}

/**
 *	Generates n goals, of type g (index in BINARY_TO_STRING_DEFINITIONS),
 *	with very random settings.
 */
function generateRandomGoals(g, n) {
	g = parseInt(g);
	if (g < 0 || g >= BINARY_TO_STRING_DEFINITIONS.length) return;
	n = parseInt(n);
	if (n < 0) return;
	var s = "White;";
	for (var i = 0;;) {
		s += binGoalToText(goalFromNumber(g, Math.random()));
		if (++i >= n) break;
		s += "bChG";
	}
	document.getElementById("textbox").value = s;

	return s;
}

/**	Exclude these challenge indices from generation: */
const GENERATE_BLACKLIST = [
	"BingoChallenge",       	//	Base class, useless in game
	"BingoVistaChallenge",  	//	full-general vista goal can't generate real room names
//	"BingoEchoChallenge",   	//	exclude less-featureful legacy versions:
//	"BingoItemHoardChallenge",
//	"BingoBombTollChallenge",
//	"BingoDamageChallenge",
];

//	patch up with:
function patchBlacklist() {
	[
		"BingoEchoChallenge",
		"BingoItemHoardChallenge",
		"BingoBombTollChallenge",
		"BingoDamageChallenge"
	].forEach(
		s => GENERATE_BLACKLIST.push(challengeValue(s))
	);
	GENERATE_BLACKLIST.sort( (a, b) => a - b );
}

function initGenerateBlacklist() {
	for (var i = 0; i < GENERATE_BLACKLIST.length; i++) {
		GENERATE_BLACKLIST[i] = challengeValue(GENERATE_BLACKLIST[i]);
	}
}

/**
 *	Generates n goals, of random types, with *very* random settings.
 */
function generateRandomRandomGoals(n) {
	n = parseInt(n);
	if (n < 0) return;
	var s = BingoEnum_CHARACTERS[Math.floor(Math.random() * BingoEnum_CHARACTERS.length)]
			+ ";";
	for (var i = 0; i < n; i++) {
		if (i > 0) s += "bChG";
		//	Try generating goals until one passes
		//	the raw encoding supports some disallowed values; filter them out
		var goalNum, goalTxt = "", goal, retries;
		goalNum = Math.floor(Math.random() * (BINARY_TO_STRING_DEFINITIONS.length - GENERATE_BLACKLIST.length));
		for (var j = 0; j < GENERATE_BLACKLIST.length; j++) {
			if (goalNum >= GENERATE_BLACKLIST[j]) goalNum++;
		}
		for (retries = 0; retries < 100; retries++) {
			goalTxt = binGoalToText(goalFromNumber(goalNum, Math.random()));
			try {
				goal = CHALLENGES[goalTxt.split("~")[0]](goalTxt.split("~")[1].split(/></), s);
			} catch (e) {
				goalTxt = "";
			}
			if (goalTxt > "") break;
		}
		if (retries >= 100) console.log("Really bad luck trying to generate a goal");
		s += goalTxt;
	}
	document.getElementById("textbox").value = s;

	return s;
}

/**
 *	Generates one random example of each possible goal type.
 */
function generateOneOfEverything() {
	var s = "White;", goalNum;
	for (var i = 0; i < BINARY_TO_STRING_DEFINITIONS.length - GENERATE_BLACKLIST.length; i++) {
		goalNum = i;
		for (var j = 0; j < GENERATE_BLACKLIST.length; j++) {
			if (goalNum >= GENERATE_BLACKLIST[j]) goalNum++;
		}
		s += binGoalToText(goalFromNumber(goalNum, Math.random())) + "bChG";
	}
	s = s.substring(0, s.length - 4);
	document.getElementById("textbox").value = s;
	parseButton();
}
