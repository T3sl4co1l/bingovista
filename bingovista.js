/* * * Constants and Defaults * * */

/* HTML IDs */
const ids = {
	clear: "clear",
	textbox: "textbox",
	parse: "parse",
	load: "fileload",
	drop: "droptarget",
	board: "board",
	square: "square",
	desc: "desctxt",
	message: "errorbox",
	darkstyle: "darkmode",
	radio1: "dark",
	radio2: "light"
};

/**
 *	List of sprite atlases, in order of precedence, highest to lowest.
 *	drawIcon() searches this list, in order, for an icon it needs; when one is found,
 *	it caches a local copy in drawIconMemoize.
 *	These are pre-loaded on startup from the named references, but unnamed or external
 *	references can be added by pushing (least priority), shifting (most), or inserting
 *	(anywhere) additional data.
 *	The named targets are not themselves referenced directly elsewhere.
 */
const atlases = [
	{ img: "bingoicons.png",   txt: "bingoicons.txt",   canv: undefined, frames: undefined },	/**< from Bingo mod */
	{ img: "uispritesmsc.png", txt: "uispritesmsc.txt", canv: undefined, frames: undefined }, 	/**< from DLC */
	{ img: "uiSprites.png",    txt: "uiSprites.txt",    canv: undefined, frames: undefined } 	/**< from base game */
];

/* Bingo square graphics constants (dimensions in px) */
const SQUARE_WIDTH = 85;
const SQUARE_HEIGHT = 85;
const SQUARE_MARGIN = 4;
const SQUARE_BORDER = 2;
const SQUARE_COLOR = "#ffffff";
const SQUARE_BACKGROUND = "#020204";
const SQUARE_FONT = "600 10pt \"Segoe UI\", sans-serif";

var board;

/** Flag to reveal full detail on otherwise-hidden challenges e.g. Vista Points */
var kibitzing = false;

/* * * Functions * * */

/* * * Event Handlers and Initialization * * */

document.addEventListener("DOMContentLoaded", function() {

	//	File load stuff
	document.getElementById(ids.clear).addEventListener("click", function(e) {
		document.getElementById(ids.textbox).value = "";
	});
	document.getElementById(ids.parse).addEventListener("click", parseText);
	document.getElementById(ids.board).addEventListener("click", selectSquare);
	document.getElementById(ids.load).addEventListener("change", function() { doLoadFile(this.files) } );
	var d = document.getElementById(ids.drop);
	d.addEventListener("dragenter", dragEnterOver);
	d.addEventListener("dragover", dragEnterOver);
	d.addEventListener("dragleave", function(e) { this.style.backgroundColor = ""; } );
	d.addEventListener("drop", dragDrop);

	function dragEnterOver(e) {
		if (e.dataTransfer.types.includes("text/plain")
				|| e.dataTransfer.types.includes("Files")) {
			e.preventDefault();
			if (document.getElementById(ids.radio1).checked)
				this.style.backgroundColor = "#686868";
			else
				this.style.backgroundColor = "#c8c8c8";
		}
	}

	document.getElementById(ids.radio1).addEventListener("change", toggleDark);
	document.getElementById(ids.radio2).addEventListener("change", toggleDark);

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
		}).catch( (e) => {
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
	Promise.all(loaders).then(function() {
		//console.log("Resources loaded!");
		var u = new URL(document.URL).searchParams;
		if (u.has("b")) {
			var board = u.get("b");
			//	parse encoded version
			var s = boardEncodeToText(board);
			//	populate text box with mod compatible format
			document.getElementById(ids.textbox).value = s;
			parseText();
		}
	}).catch(function(e) {
		console.log("Promise.all(): failed to complete fetches. Error: " + e.message);
	});

	if (document.getElementById(ids.radio1).checked)
		document.getElementById(ids.darkstyle).media = "screen";
	else
		document.getElementById(ids.darkstyle).media = "none";

});

/**
 *	Color theme button changed.
 */
function toggleDark(e) {
	if (document.getElementById(ids.radio1).checked)
		document.getElementById(ids.darkstyle).media = "screen";
	else
		document.getElementById(ids.darkstyle).media = "none";
}

/**
 *	Data dropped onto the page.
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
					document.getElementById(ids.textbox).value = s;
					parseText();
				});
				return;
			}
		}
		setError("Please drop a text file.");
	}
}

/**
 *	Sets a message in the error box.
 */
function setError(s) {
	var mb = document.getElementById(ids.message);
	while (mb.firstChild)
		mb.removeChild(mb.firstChild);
	mb.appendChild(document.createTextNode(s));
}

function doLoadFile(files) {
	for (var i = 0; i < files.length; i++) {
		if (files[i].type.match("^text/plain")) {
			var fr = new FileReader();
			fr.onload = function() {
				document.getElementById(ids.textbox).value = this.result;
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
 *	Parses an encoded string into a text-formatted board.
 */
function boardEncodeToText(s) {
	return s;
}

/**
 *	Parse Text button pressed.
 */
function parseText(e) {
	var s = document.getElementById(ids.textbox).value;
	s = s.trim().replace(/\s*bChG\s*/g, "bChG");
	var goals = s.split(/bChG/);
	var size = Math.ceil(Math.sqrt(goals.length));
	board = { size: size, width: size, height: size, goals: [] };
	for (var i = 0; i < goals.length; i++) {
		var type, desc;
		if (goals[i].search("~") > 0 && goals[i].search("><") > 0) {
			[type, desc] = goals[i].split("~");
			desc = desc.split(/></);
			if (CHALLENGES[type] !== undefined) {
				try {
					board.goals.push(CHALLENGES[type](desc));
				} catch (e) {
					board.goals.push(defaultGoal(type, desc));
					board.goals[board.goals.length - 1].description = e.message;
				}
			} else {
				board.goals.push(defaultGoal(type, desc));
			}
		} else {
			board.goals.push(CHALLENGES["BingoChallenge"]());
		}
	}

	function defaultGoal(t, d) {
		return {
			name: t,
			category: "error",
			items: [],
			description: "Unable to generate this goal; descriptor: " + d.join("><"),
			values: [],
			paint: [
				{ type: "verse", value: "∅", scale: 1, color: "#ffffff", rotation: 0 }
			]
		};
	}

	var ctx = document.getElementById(ids.board).getContext("2d");
	ctx.fillStyle = SQUARE_BACKGROUND;
	ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
	for (var i = 0; i < board.goals.length; i++) {
		drawSquare(ctx, board.goals[i],
				Math.floor(i / board.height) * (SQUARE_WIDTH + SQUARE_MARGIN + SQUARE_BORDER) + (SQUARE_BORDER + SQUARE_MARGIN) / 2,
				(i % board.height) * (SQUARE_HEIGHT + SQUARE_MARGIN + SQUARE_BORDER) + (SQUARE_BORDER + SQUARE_MARGIN) / 2);
	}

	//console.log(board);
}

/**
 *	Clicked on canvas.
 */
function selectSquare(e) {
	var el = document.getElementById(ids.desc);
	var ctx = document.getElementById(ids.square).getContext("2d");
	if (board === undefined) {
		clearDescription();
		return;
	}
	var x = e.offsetX - (SQUARE_BORDER + SQUARE_MARGIN) / 2;
	var y = e.offsetY - (SQUARE_BORDER + SQUARE_MARGIN) / 2;
	var sqWidth = SQUARE_WIDTH + SQUARE_MARGIN + SQUARE_BORDER;
	var sqHeight = SQUARE_WIDTH + SQUARE_MARGIN + SQUARE_BORDER;
	var col = Math.floor(x / sqWidth);
	var row = Math.floor(y / sqHeight);
	if (x >=0 && y >= 0 && (x % sqWidth) < (sqWidth - SQUARE_MARGIN)
			&& (y % sqHeight) < (sqHeight - SQUARE_MARGIN)
			&& row < board.height && col < board.width) {
		var goal = board.goals[row + col * board.height];
		if (goal === undefined) {
			clearDescription();
			return;
		}
		ctx.fillStyle = SQUARE_BACKGROUND;
		ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
		drawSquare(ctx, goal, (SQUARE_BORDER + SQUARE_MARGIN) / 2, (SQUARE_BORDER + SQUARE_MARGIN) / 2);
		while (el.firstChild)
			el.removeChild(el.firstChild);
		var s = "Challenge: " + goal.category;
		for (var i = 0; i < goal.items.length && i < goal.values.length; i++) {
			s += (goal.items[i].length > 0) ? ("<br>" + goal.items[i] + ": " + goal.values[i]) : "";
		}
		s += "<br>" + goal.description;
		el.innerHTML = s;
		return;
	}
	clearDescription();

	function clearDescription() {
		ctx.fillStyle = SQUARE_BACKGROUND;
		ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
		while (el.firstChild)
			el.removeChild(el.firstChild);
		el.appendChild(document.createTextNode("Select a square to view details."));
	}
}

/**
 *	Draw a challenge square to the specified canvas at the specified location (top-left corner).
 */
function drawSquare(ctx, goal, x, y) {
	ctx.beginPath();
	ctx.strokeStyle = SQUARE_COLOR;
	ctx.lineWidth = SQUARE_BORDER;
	ctx.lineCap = "butt";
	ctx.moveTo(x, y);
	ctx.lineTo(x + SQUARE_WIDTH, y);
	ctx.moveTo(x + SQUARE_WIDTH, y);
	ctx.lineTo(x + SQUARE_WIDTH, y + SQUARE_HEIGHT);
	ctx.moveTo(x + SQUARE_WIDTH, y + SQUARE_HEIGHT);
	ctx.lineTo(x, y + SQUARE_HEIGHT);
	ctx.moveTo(x, y + SQUARE_HEIGHT);
	ctx.lineTo(x, y);
	ctx.stroke();
	ctx.imageSmoothingEnabled = "false";
	var lines = [], thisLine = [];
	for (var i = 0; i < goal.paint.length; i++) {
		if (goal.paint[i].type == "break") {
			lines.push(thisLine);
			thisLine = [];
		} else {
			thisLine.push(goal.paint[i]);
		}
	}
	if (thisLine.length) lines.push(thisLine);
	ctx.font = SQUARE_FONT;
	ctx.textAlign = "center"; ctx.textBaseline = "middle";
	var xBase, yBase;
	for (var i = 0; i < lines.length; i++) {
		yBase = y + SQUARE_BORDER / 2 + (SQUARE_HEIGHT - SQUARE_BORDER) * (i + 1) / (lines.length + 1);
		yBase = Math.round(yBase);
		for (var j = 0; j < lines[i].length; j++) {
			xBase = x + SQUARE_BORDER / 2 + (SQUARE_WIDTH - SQUARE_BORDER) * (j + 1) / (lines[i].length + 1);
			xBase = Math.round(xBase);
			if (lines[i][j].type == "icon") {
				drawIcon(ctx, lines[i][j].value, xBase, yBase, lines[i][j].color, lines[i][j].scale, lines[i][j].rotation); 
			} else if (lines[i][j].type == "text") {
				ctx.fillStyle = lines[i][j].color;
				ctx.fillText(lines[i][j].value, xBase, yBase);
			} else {
				//	unimplemented
				drawIcon(ctx, "Futile_White", xBase, yBase, "#ffffff", lines[i][j].scale || 1, lines[i][j].rotation || 0); 
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
 *	Challenge classes from Bingomod decomp.
 */
const CHALLENGES = {
	BingoAchievementChallenge: function(desc) {
		const thisname = "BingoAchievementChallenge";
		//	assert: desc of format ["System.String|Traveller|Passage|0|passage", "0", "0"]
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Passage", , "passage"], "goal selection");
		if (passageToDisplayNameMap[items[1]] === undefined)
			throw new TypeError(thisname + ": error, '" + items[1] + "' not passageable");
		return {
			name: thisname,
			category: "Obtaining passages",
			items: ["Passage"],
			values: [items[1]],
			description: "Earn " + passageToDisplayNameMap[items[1]] + " passage.",
			paint: [
				{ type: "icon", value: "smallEmptyCircle", scale: 1, color: "#ffffff", rotation: 0 },
				{ type: "icon", value: items[1] + "A", scale: 1, color: "#ffffff", rotation: 0 },
				{ type: "icon", value: "smallEmptyCircle", scale: 1, color: "#ffffff", rotation: 0 }
			]
		};
	},
	BingoAllRegionsExcept: function(desc) {
		const thisname = "BingoAllRegionsExcept";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoBombTollChallenge: function(desc) {
		const thisname = "BingoBombTollChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoChallenge: function() {
		const thisname = "BingoChallenge";
		//	Keep as template and default
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Unimplemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoCollectPearlChallenge: function(desc) {
		const thisname = "BingoCollectPearlChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoCraftChallenge: function(desc) {
		const thisname = "BingoCraftChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoCreatureGateChallenge: function(desc) {
		const thisname = "BingoCreatureGateChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoCycleScoreChallenge: function(desc) {
		const thisname = "BingoCycleScoreChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoDamageChallenge: function(desc) {
		const thisname = "BingoDamageChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoDepthsChallenge: function(desc) {
		const thisname = "BingoDepthsChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoDodgeLeviathanChallenge: function(desc) {
		const thisname = "BingoDodgeLeviathanChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoDontUseItemChallenge: function(desc) {
		const thisname = "BingoDontUseItemChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoEatChallenge: function(desc) {
		const thisname = "BingoEatChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoEchoChallenge: function(desc) {
		const thisname = "BingoEchoChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoEnterRegionChallenge: function(desc) {
		const thisname = "BingoEnterRegionChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoGlobalScoreChallenge: function(desc) {
		const thisname = "BingoGlobalScoreChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoGreenNeuronChallenge: function(desc) {
		const thisname = "BingoGreenNeuronChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoHatchNoodleChallenge: function(desc) {
		const thisname = "BingoHatchNoodleChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoHellChallenge: function(desc) {
		const thisname = "BingoHellChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoItemHoardChallenge: function(desc) {
		const thisname = "BingoItemHoardChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoKarmaFlowerChallenge: function(desc) {
		const thisname = "BingoKarmaFlowerChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoKillChallenge: function(desc) {
		const thisname = "BingoKillChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoMaulTypesChallenge: function(desc) {
		const thisname = "BingoMaulTypesChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoMaulXChallenge: function(desc) {
		const thisname = "BingoMaulXChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoNeuronDeliveryChallenge: function(desc) {
		const thisname = "BingoNeuronDeliveryChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoNoNeedleTradingChallenge: function(desc) {
		const thisname = "BingoNoNeedleTradingChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoNoRegionChallenge: function(desc) {
		const thisname = "BingoNoRegionChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoPearlDeliveryChallenge: function(desc) {
		const thisname = "BingoPearlDeliveryChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoPearlHoardChallenge: function(desc) {
		const thisname = "BingoPearlHoardChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoPinChallenge: function(desc) {
		const thisname = "BingoPinChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoPopcornChallenge: function(desc) {
		const thisname = "BingoPopcornChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoRivCellChallenge: function(desc) {
		const thisname = "BingoRivCellChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoSaintDeliveryChallenge: function(desc) {
		const thisname = "BingoSaintDeliveryChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoSaintPopcornChallenge: function(desc) {
		const thisname = "BingoSaintPopcornChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoStealChallenge: function(desc) {
		const thisname = "BingoStealChallenge";
		const theftEnum = [	//	ChallengeUtils.stealableStoable
			"Spear",
			"Rock",
			"ScavengerBomb",
			"Lantern",
			"GooieDuck",
			"GlowWeed",
			"DataPearl"	//	added by GetCorrectListForChallenge()
		];
		//	assert: desc of format ["System.String|Rock|Item|1|theft",
		//	"System.Boolean|false|From Scavenger Toll|0|NULL",
		//	"0", "System.Int32|3|Amount|2|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 6, "parameter item count");
		var r = {
			name: thisname,
			category: "Stealing items",
			items: [],
			values: [],
			description: "",
			paint: [
				{ type: "icon", value: "steal_item", scale: 1, color: "#ffffff", rotation: 0 }
			]
		};
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Item", , "theft"], "item selection");
		if (!theftEnum.includes(items[1]))
			throw new TypeError(thisname + ": error, " + items[1] + " not theftable");
		r.items.push(items[2]); r.values.push(items[1]);
		r.paint.push( { type: "icon", value: itemNameToIconAtlasMap[items[1]], scale: 1,
				color: itemToColor(items[1]), rotation: 0 } );
		r.description += ItemNameToDisplayTextMap[items[1]] + " from ";
		items = checkSettingbox(thisname, desc[1], ["System.Boolean", , "From Scavenger Toll", , "NULL"], "venue flag");
		r.items.push(items[2]); r.values.push(items[1]);
		if (items[1] == "true") {
			r.paint.push( { type: "icon", value: "scavtoll", scale: 0.8, color: "#ffffff", rotation: 0 } );
			r.description += "a Scavenger Toll";
		} else {
			r.paint.push( { type: "icon", value: creatureNameToIconAtlasMap["Scavenger"], scale: 1,
					color: creatureToColor("Scavenger"), rotation: 0 } );
			r.description += "Scavengers";
		}
		items = checkSettingbox(thisname, desc[3], ["System.Int32", , "Amount", , "NULL"], " item count");
		r.items.splice(1, 0, items[2]); r.values.splice(1, 0, items[1]);
		r.paint.push( { type: "break" } );
		r.paint.push( { type: "text", value: "[0/" + items[1] + "]", color: "#ffffff" } );
		r.description = "Steal [0/" + items[1] + "] " + r.description + ".";
		return r;
	},
	BingoTameChallenge: function(desc) {
		const thisname = "BingoTameChallenge";
		//	assert: desc of format ["System.String|EelLizard|Creature Type|0|friend", "0", "0"]
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = desc[0].split("|");
		checkDescriptors(thisname, items.length, 5, "descriptor item count");
		checkDescriptors(thisname, items[0], "System.String", "assert failed, type");
		checkDescriptors(thisname, items[2], "Creature Type", "item list name");
		var d = creatureNameToDisplayTextMap[items[1]];
		if (d === undefined)
			throw new TypeError("creatureNameToDisplayTextMap: type '" + String(items[1]) + "' not found in list");
		//	English cleanup (have fun translating this..?)
		if (d.lastIndexOf("s") > 0) d = d.slice(0, d.lastIndexOf("s"));
		var anVowel = "";
		if (["A", "a", "E", "e", "I", "i", "O", "o", "U", "u"].includes(d.substring(0, 1)))
			anVowel = "n";
		return {
			name: thisname,
			category: "Befriending a creature",
			items: ["Creature Type"],
			values: [items[1]],
			description: "Befriend a" + anVowel + " " + d + ".",
			paint: [
				{ type: "icon", value: "FriendB", scale: 1, color: "#ffffff", rotation: 0 },
				{ type: "icon", value: creatureNameToIconAtlasMap[items[1]], scale: 1,
						color: creatureToColor(items[1]), rotation: 0 }
			]
		};
	},
	BingoTradeChallenge: function(desc) {
		const thisname = "BingoTradeChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoTradeTradedChallenge: function(desc) {
		const thisname = "BingoTradeTradedChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoTransportChallenge: function(desc) {
		const thisname = "BingoTransportChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoUnlockChallenge: function(desc) {
		const thisname = "BingoUnlockChallenge";
		//
		return {
			name: thisname,
			category: "null",
			items: [],
			values: [],
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoVistaChallenge: function(desc) {
		const thisname = "BingoVistaChallenge";
		//	desc of format ["CC", "System.String|CC_A10|Room|0|vista", "734", "506", "0", "0"]
		checkDescriptors(thisname, desc.length, 6, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.String", , "Room", , "vista"], "item selection");
		//	desc[0] is region code
		var v = (regionCodeToDisplayName[desc[0]] || "") + " / " + (regionCodeToDisplayNameSaint[desc[0]] || "");
		v = v.replace(/^\s\/\s|\s\/\s$/g, "");
		v = v || "Unknown Region";
		return {
			name: thisname,
			category: "Visiting vistas",
			items: ["Region"],
			values: [desc[0]],
			description: "Reach the vista point in " + v + "." + (kibitzing ? ("<br>Room: " + items[1] + " at x: " + desc[2] + ", y: " + desc[3]) : ""),
			paint: [
				{ type: "icon", value: "vistaicon", scale: 1, color: "#ffffff", rotation: 0 },
				{ type: "break" },
				{ type: "text", value: desc[0], color: "#ffffff" }
			]
		};
	}
};

/**
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
			throw new TypeError(t + ": " + err + ", found " + items[i] + ", expected: " + String(f[i]));
	}
	return items;
}

/**
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
	if (typeof(d) === "string") s = "'" + s + "'";
	if (typeof(g) === "string") h = "'" + h + "'";
	if (d != g) throw new TypeError(t + ": error, " + err + " " + s + ", expected: " + h);
}

/* * * Utility Functions * * */


function itemToColor(i) {
	var colr = itemNameToIconColorMap[i] || itemNameToIconColorMap["Default"];
	return colorFloatToString(...colr);
}

function creatureToColor(c) {
	var colr = creatureNameToIconColorMap[c] || creatureNameToIconColorMap["Default"];
	return colorFloatToString(...colr);
}

/**
 *	Convert floating point triple to HTML color string.
 */
function colorFloatToString(r, g, b) {
	return "#" + ("00000" + (
			(toInt(r) << 16) + (toInt(g) << 8) + toInt(b)
		).toString(16)).slice(-6);

	function toInt(x) {
		return Math.min(255, Math.max(0, Math.floor(x * 256)));
	}
}

/**
 *	Grabbed from RWCustom.Custom::HSL2RGB
 */
function HSL2RGB(h, s, l) {
	var r = l;
	var g = l;
	var b = l;
	var num = (l <= 0.5) ? (l * (1 + s)) : (l + s - l * s);
	if (num > 0) {
		var num2 = l + l - num;
		var num3 = (num - num2) / num;
		h *= 6;
		var num4 = Math.floor(h);
		var num5 = h - num4;
		var num6 = num * num3 * num5;
		var num7 = num2 + num6;
		var num8 = num - num6;
		switch (num4) {
		case 0:
			r = num;
			g = num7;
			b = num2;
			break;
		case 1:
			r = num8;
			g = num;
			b = num2;
			break;
		case 2:
			r = num2;
			g = num;
			b = num7;
			break;
		case 3:
			r = num2;
			g = num8;
			b = num;
			break;
		case 4:
			r = num7;
			g = num2;
			b = num;
			break;
		case 5:
			r = num;
			g = num2;
			b = num8;
			break;
		}
	}
	return [r, g, b];
}

/**
 *	Possible Passages (achievements)
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
	"VS": "Pipeyard"
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
	"MS": "Submerged Superstructure",
	"SB": "Primordial Underground",
	"SI": "Windswept Spires",
	"SL": "Frigid Coast",
	"SU": "Suburban Drifts",
	"UG": "Undergrowth",
	"VS": "Barren Conduits"
};

/**
 *	Convert creature value string to display text.
 *	Game extract: ChallengeTools::CreatureName
 */
const creatureNameToDisplayTextMap = {
	"Slugcat":         "Slugcats",
	"GreenLizard":     "Green Lizards",
	"PinkLizard":      "Pink Lizards",
	"BlueLizard":      "Blue Lizards",
	"WhiteLizard":     "White Lizards",
	"BlackLizard":     "Black Lizards",
	"YellowLizard":    "Yellow Lizards",
	"CyanLizard":      "Cyan Lizards",
	"RedLizard":       "Red Lizards",
	"Salamander":      "Salamander",
	"CicadaA":         "White Cicadas",
	"CicadaB":         "Black Cicadas",
	"Snail":           "Snails",
	"PoleMimic":       "Pole Mimics",
	"TentaclePlant":   "Monster Kelp",
	"Scavenger":       "Scavengers",
	"Vulture":         "Vultures",
	"KingVulture":     "King Vultures",
	"SmallCentipede":  "Small Centipedes",
	"Centipede":       "Large Centipedes",
	"RedCentipede":    "Red Centipedes",
	"Centiwing":       "Centiwings",
	"LanternMouse":    "Lantern Mice",
	"BigSpider":       "Large Spiders",
	"SpitterSpider":   "Spitter Spiders",
	"MirosBird":       "Miros Birds",
	"BrotherLongLegs": "Brother Long Legs",
	"DaddyLongLegs":   "Daddy Long Legs",
	"TubeWorm":        "Tube Worms",
	"EggBug":          "Egg Bugs",
	"DropBug":         "Dropwigs",
	"BigNeedleWorm":   "Large Noodleflies",
	"JetFish":         "Jetfish",
	"BigEel":          "Leviathans",
	"Deer":            "Rain Deer",
	"Fly":             "Batflies",
	"MirosVulture":    "Miros Vultures",
	"MotherSpider":    "Mother Spiders",
	"EelLizard":       "Eel Lizards",
	"SpitLizard":      "Caramel Lizards",
	"TerrorLongLegs":  "Terror Long Legs",
	"AquaCenti":       "Aquapedes",
	"FireBug":         "Firebugs",
	"Inspector":       "Inspectors",
	"Yeek":            "Yeek",
	"BigJelly":        "Large Jellyfish",
	"StowawayBug":     "Stowaway Bugs",
	"ZoopLizard":      "Strawberry Lizards",
	"ScavengerElite":  "Elite Scavengers",
	"SlugNPC":         "Slugcats"
};

/**
 *	Convert creature value string to atlas name string.
 *	TODO?: Throws if key not found (currently returns "Futile_White" game default)
 *	TODO?: refactor to associative array (convert ifs, ||s into more properties?
 *	    minor manual edit overhead)
 */
function creatureNameToIconAtlas(type) {
	/*
	 *	Game extract: CreatureSymbol::SpriteNameOfCreature
	 *	Paste in verbatim, then make these changes:
	 *	- Adjust tabbing level to current scope
	 *	- Search and replace:
	 *		/CreatureTemplate\.Type\.|MoreSlugcatsEnums\.CreatureTemplateType\./ --> "\""
	 *		/iconData\.critType/ --> "type"
	 *		/\)\r\n\t{1,2}\{\r\n\t{2,3}/ --> "\"\)\r\n\t\t"
	 *		/\t{1,2}\}\r\n\t{1,2}if/ --> "\tif"
	 *		/\s\|\|\s/ --> "\" || "
	 *	- Remove MSC sub-clause
	 *	- Centipede clause: changed to use default index 2, since Bingo doesn't
	 *		distinguish between centipede sizes
	 *	- Yes, using regex on code is messy, inspect the results!  Don't be a dummy!
	 *	- Assumes CreatureTemplate enums use symbols equal to string contents; this appears to
	 *		always be the case, but may vary with future updates, or modded content.  Beware!
	 */
	if (type == "Slugcat")
		return "Kill_Slugcat";
	if (type == "GreenLizard")
		return "Kill_Green_Lizard";
	if (type == "PinkLizard" || type == "BlueLizard" || type == "CyanLizard" || type == "RedLizard")
		return "Kill_Standard_Lizard";
	if (type == "WhiteLizard")
		return "Kill_White_Lizard";
	if (type == "BlackLizard")
		return "Kill_Black_Lizard";
	if (type == "YellowLizard")
		return "Kill_Yellow_Lizard";
	if (type == "Salamander")
		return "Kill_Salamander";
	if (type == "Scavenger")
		return "Kill_Scavenger";
	if (type == "Vulture")
		return "Kill_Vulture";
	if (type == "KingVulture")
		return "Kill_KingVulture";
	if (type == "CicadaA" || type == "CicadaB")
		return "Kill_Cicada";
	if (type == "Snail")
		return "Kill_Snail";
	if (type == "Centiwing")
		return "Kill_Centiwing";
	if (type == "SmallCentipede")
		return "Kill_Centipede1";
	if (type == "Centipede")
		return "Kill_Centipede2";
	if (type == "RedCentipede")
		return "Kill_Centipede3";
	if (type == "BrotherLongLegs" || type == "DaddyLongLegs")
		return "Kill_Daddy";
	if (type == "LanternMouse")
		return "Kill_Mouse";
	if (type == "GarbageWorm")
		return "Kill_Garbageworm";
	if (type == "Fly")
		return "Kill_Bat";
	if (type == "Leech" || type == "SeaLeech")
		return "Kill_Leech";
	if (type == "Spider")
		return "Kill_SmallSpider";
	if (type == "JetFish")
		return "Kill_Jetfish";
	if (type == "BigEel")
		return "Kill_BigEel";
	if (type == "Deer")
		return "Kill_RainDeer";
	if (type == "TubeWorm")
		return "Kill_Tubeworm";
	if (type == "TentaclePlant")
		return "Kill_TentaclePlant";
	if (type == "PoleMimic")
		return "Kill_PoleMimic";
	if (type == "MirosBird")
		return "Kill_MirosBird";
	if (type == "Overseer")
		return "Kill_Overseer";
	if (type == "VultureGrub")
		return "Kill_VultureGrub";
	if (type == "EggBug")
		return "Kill_EggBug";
	if (type == "BigSpider" || type == "SpitterSpider")
		return "Kill_BigSpider";
	if (type == "BigNeedleWorm")
		return "Kill_NeedleWorm";
	if (type == "SmallNeedleWorm")
		return "Kill_SmallNeedleWorm";
	if (type == "DropBug")
		return "Kill_DropBug";
	if (type == "Hazer")
		return "Kill_Hazer";
	if (type == "TrainLizard")
		return "Kill_Standard_Lizard";
	if (type == "ZoopLizard")
		return "Kill_White_Lizard";
	if (type == "EelLizard")
		return "Kill_Salamander";
	if (type == "JungleLeech")
		return "Kill_Leech";
	if (type == "TerrorLongLegs")
		return "Kill_Daddy";
	if (type == "MotherSpider")
		return "Kill_BigSpider";
	if (type == "StowawayBug")
		return "Kill_Stowaway";
	if (type == "HunterDaddy")
		return "Kill_Slugcat";
	if (type == "FireBug")
		return "Kill_FireBug";
	if (type == "AquaCenti")
		return "Kill_Centiwing";
	if (type == "MirosVulture")
		return "Kill_MirosBird";
	if (type == "FireBug")
		return "Kill_EggBug";
	if (type == "ScavengerElite")
		return "Kill_ScavengerElite";
	if (type == "ScavengerKing")
		return "Kill_ScavengerKing";
	if (type == "SpitLizard")
		return "Kill_Spit_Lizard";
	if (type == "Inspector")
		return "Kill_Inspector";
	if (type == "Yeek")
		return "Kill_Yeek";
	if (type == "BigJelly")
		return "Kill_BigJellyFish";
	if (type == "SlugNPC")
		return "Kill_Slugcat";
	return "Futile_White";
}

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
	"RedCentipede":   	"Kill_Centipede3",
	"BrotherLongLegs":	"Kill_Daddy",
	"DaddyLongLegs":  	"Kill_Daddy",
	"LanternMouse":   	"Kill_Mouse",
	"GarbageWorm":    	"Kill_Garbageworm",
	"Fly":            	"Kill_Bat",
	"Leech":          	"Kill_Leech",
	"SeaLeech":       	"Kill_Leech",
	"Spider":         	"Kill_SmallSpider",
	"JetFish":        	"Kill_Jetfish",
	"BigEel":         	"Kill_BigEel",
	"Deer":           	"Kill_RainDeer",
	"TubeWorm":       	"Kill_Tubeworm",
	"TentaclePlant":  	"Kill_TentaclePlant",
	"PoleMimic":      	"Kill_PoleMimic",
	"MirosBird":      	"Kill_MirosBird",
	"Overseer":       	"Kill_Overseer",
	"VultureGrub":    	"Kill_VultureGrub",
	"EggBug":         	"Kill_EggBug",
	"BigSpider":      	"Kill_BigSpider",
	"SpitterSpider":  	"Kill_BigSpider",
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
	"FireBug":        	"Kill_EggBug",
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
 *	Convert creature value string to HTML color.
 *	TODOs: same as creatureNameToIconAtlas().
 */
function creatureNameToIconColor(type) {
	//	values excerpted from LizardBreeds::BreedTemplate; returns array [r, g, b]
	//	(base body colors, not necessarily icon colors? hence the unused values?)
	const standardColor = {
		"GreenLizard":  [0.2,      1,       0       ],
		"PinkLizard":   [1,        0,       1       ],
		"BlueLizard":   [0,        0.5,     1       ],
		"YellowLizard": [1,        0.6,     0       ],
		"WhiteLizard":  [1,        1,       1       ],
		"RedLizard":    [1,        0,       0       ],	//	unused
		"BlackLizard":  [0.1,      0.1,     0.1     ],	//	unused
		"Salamander":   [1,        1,       1       ],	//	unused
		"CyanLizard":   [0,        1,       0.9     ],	//	unused
		"SpitLizard":   [0.55,     0.4,     0.2     ],
		"ZoopLizard":   [0.95,     0.73,    0.73    ],	//	unused
		"TrainLizard":  [0.254902, 0,       0.215686]	//	unused
	};
	/*
	 *	Game extract: CreatureSymbol::ColorOfCreature
	 *	Paste in verbatim, then make these changes:
	 *	- Adjust tabbing level to current scope
	 *	- Search and replace:
	 *		/iconData\.critType\s==\sCreatureTemplate\.Type\.|iconData\.critType\s==\sMoreSlugcatsEnums\.CreatureTemplateType\./ --> "type == \""
	 *		/\)\r\n\t{1,2}\{\r\n\t{2,3}/ --> "\"\)\r\n\t\t"
	 *		/\t{1,2}\}\r\n\t{1,2}if/ --> "\tif"
	 *		/\s\|\|\s/ --> "\" || "
	 *		/return\snew\sColor\(/ --> "c = ["
	 *		/\);\r\n\t{1,2}\}/ --> "];"
	 *		/return\s\(StaticWorld\.GetCreatureTemplate\(iconData\.critType\)\.breedParameters\sas\sLizardBreedParams\)\.standardColor;\r\n\t\}/ --> "c = standardColor\[type\];"
	 *	- remove f's on colors (e.g. /f\,\s/ --> ", " then /f]/ --> ", " then 
	 *	- Remove MSC sub-clause
	 *	- Manually find and replace targets for slugcat ArenaColor, HunterDaddy and MenuColors.MediumGrey
	 *	- Yes, using regex on code is messy, inspect the results!  Don't be a dummy!
	 *	- Assumes CreatureTemplate enums use symbols equal to string contents; this appears to
	 *		always be the case, but may vary with future updates, or modded content.  Beware!
	 */
	var c = HSL2RGB(0.73055553, 0.08, 0.67);	//	Menu.Menu::MenuColor (default value hoisted from end)
	if (type == "Slugcat")
		c = [1, 1, 1];	//	PlayerGraphics::DefaultSlugcatColor (White)
	if (type == "GreenLizard")
		c = standardColor[type];
	if (type == "PinkLizard")
		c = standardColor[type];
	if (type == "BlueLizard")
		c = standardColor[type];
	if (type == "WhiteLizard")
		c = standardColor[type];
	if (type == "RedLizard")
		c = [0.9019608, 0.05490196, 0.05490196];
	if (type == "BlackLizard")
		c = [0.36862746, 0.36862746, 0.43529412];
	if (type == "YellowLizard" || type == "SmallCentipede" || type == "Centipede")
		c = [1, 0.6, 0];
	if (type == "RedCentipede")
		c = [0.9019608, 0.05490196, 0.05490196];
	if (type == "CyanLizard" || type == "Overseer")
		c = [0, 0.9098039, 0.9019608];
	if (type == "Salamander")
		c = [0.93333334, 0.78039217, 0.89411765];
	if (type == "CicadaB")
		c = [0.36862746, 0.36862746, 0.43529412];
	if (type == "CicadaA")
		c = [1, 1, 1];
	if (type == "SpitterSpider" || type == "Leech")
		c = [0.68235296, 0.15686275, 0.11764706];
	if (type == "SeaLeech" || type == "TubeWorm")
		c = [0.05, 0.3, 0.7];
	if (type == "Centiwing")
		c = [0.05490196, 0.69803923, 0.23529412];
	if (type == "BrotherLongLegs")
		c = [0.45490196, 0.5254902, 0.30588236];
	if (type == "DaddyLongLegs")
		c = [0, 0, 1];
	if (type == "VultureGrub")
		c = [0.83137256, 0.7921569, 0.43529412];
	if (type == "EggBug")
		c = [0, 1, 0.47058824];
	if (type == "BigNeedleWorm" || type == "SmallNeedleWorm")
		c = [1, 0.59607846, 0.59607846];
	if (type == "Hazer")
		c = [0.21176471, 0.7921569, 0.3882353];
	if (type == "Vulture" || type == "KingVulture")
		c = [0.83137256, 0.7921569, 0.43529412];
	if (type == "ZoopLizard")
		c = [0.95, 0.73, 0.73];
	if (type == "StowawayBug")
		c = [0.36862746, 0.36862746, 0.43529412];
	if (type == "AquaCenti")
		c = [0, 0, 1];
	if (type == "TerrorLongLegs" || type == "TrainLizard")
		c = [0.3, 0, 1];
	if (type == "MotherSpider" || type == "JungleLeech")
		c = [0.1, 0.7, 0.1];
	if (type == "HunterDaddy")
		//	var a = {r: 1, g: 0.4509804, b: 0.4509804};	//	PlayerGraphics::DefaultSlugcatColor (Red)
		//	var b = {r: 0.5, g: 0.5, b: 0.5}, t = 0.4;	//	UnityEngine.Color::gray
		//	//	Lerp 0.4:
		//	var c = {r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t};	//	UnityEngine.Color::Lerp(a, b)
		//	-> c = {r: 0.8, g: 0.47058824, b: 0.47058824}
		c = [0.8, 0.47058824, 0.47058824];
	if (type == "MirosVulture")
		c = [0.9019608, 0.05490196, 0.05490196];
	if (type == "FireBug")
		c = [1, 0.47058824, 0.47058824];
	if (type == "SpitLizard")
		c = standardColor[type];
	if (type == "EelLizard")
		c = [0.02, 0.78039217, 0.2];
	if (type == "Inspector")
		c = [0.44705883, 0.9019608, 0.76862746];
	if (type == "Yeek")
		c = [0.9, 0.9, 0.9];
	if (type == "BigJelly")
		c = [1, 0.85, 0.7];
	/* end copy */

	return colorFloatToString(...c);
}

/**
 *	Refactoring of creatureNameToIconColor() to associative array.
 */
const creatureNameToIconColorMap = {
	"Slugcat":        	[1,        1,        1       ],
	"GreenLizard":    	[0.2,      1,        0       ],
	"PinkLizard":     	[1,        0,        1       ],
	"BlueLizard":     	[0,        0.5,      1       ],
	"WhiteLizard":    	[1,        1,        1       ],
	"RedLizard":      	[0.901961, 0.054902, 0.054902],
	"BlackLizard":    	[0.368627, 0.368627, 0.435294],
	"YellowLizard":	  	[1,        0.6,      0       ],
	"SmallCentipede": 	[1,        0.6,      0       ],
	"Centipede":      	[1,        0.6,      0       ],
	"RedCentipede":   	[0.901961, 0.054902, 0.054902],
	"CyanLizard":     	[0,        0.909804, 0.901961],
	"Overseer":       	[0,        0.909804, 0.901961],
	"Salamander":     	[0.933333, 0.780392, 0.894118],
	"CicadaB":        	[0.368627, 0.368627, 0.435294],
	"CicadaA":        	[1,        1,        1       ],
	"SpitterSpider":  	[0.682353, 0.156863, 0.117647],
	"Leech":          	[0.682353, 0.156863, 0.117647],
	"SeaLeech":       	[0.05,     0.3,      0.7     ],
	"TubeWorm":       	[0.05,     0.3,      0.7     ],
	"Centiwing":      	[0.054902, 0.698039, 0.235294],
	"BrotherLongLegs":	[0.454902, 0.52549,  0.305882],
	"DaddyLongLegs":  	[0,        0,        1       ],
	"VultureGrub":    	[0.831373, 0.792157, 0.435294],
	"EggBug":         	[0,        1,        0.470588],
	"BigNeedleWorm":  	[1,        0.596078, 0.596078],
	"SmallNeedleWorm":	[1,        0.596078, 0.596078],
	"Hazer":          	[0.211765, 0.792157, 0.388235],
	"Vulture":        	[0.831373, 0.792157, 0.435294],
	"KingVulture":    	[0.831373, 0.792157, 0.435294],
	"ZoopLizard":     	[0.95,     0.73,     0.73    ],
	"StowawayBug":    	[0.368627, 0.368627, 0.435294],
	"AquaCenti":      	[0,        0,        1       ],
	"TerrorLongLegs": 	[0.3,      0,        1       ],
	"TrainLizard":    	[0.3,      0,        1       ],
	"MotherSpider":   	[0.1,      0.7,      0.1     ],
	"JungleLeech":    	[0.1,      0.7,      0.1     ],
	"HunterDaddy":    	[0.8,      0.470588, 0.470588],
	"MirosVulture":   	[0.901961, 0.054902, 0.054902],
	"FireBug":        	[1,        0.470588, 0.470588],
	"SpitLizard":     	[0.55,     0.4,      0.2     ],
	"EelLizard":      	[0.02,     0.780392, 0.2     ],
	"Inspector":      	[0.447059, 0.901961, 0.768627],
	"Yeek":           	[0.9,      0.9,    0.9       ],
	"BigJelly":       	[1,        0.85,   0.7       ],
	"Default":        	[0.66384,  0.6436, 0.6964    ]
};

/**
 *	Convert item value string to display text string.
 */
const ItemNameToDisplayTextMap = {
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
	"OverseerCarcass":  "Overseer Eye"	//	manual add (maybe sometime?)
};

/**
 *	Convert item value string to atlas name string.
 */
const itemNameToIconAtlasMap = {
	//	base game, ItemSymbol.SpriteNameForItem
	"Rock":             "Symbol_Rock",
	"Spear":            "Symbol_Spear",
	"Spear1":           "Symbol_FireSpear",
	"Spear2":           "Symbol_ElectricSpear",
	"Spear3":           "Symbol_HellSpear",
	"ScavengerBomb":    "Symbol_StunBomb",
	"SporePlant":       "Symbol_SporePlant",
	"Lantern":          "Symbol_Lantern",
	"FlareBomb":        "Symbol_FlashBomb",
	"PuffBall":         "Symbol_PuffBall",
	"WaterNut":         "Symbol_WaterNut",
	"FirecrackerPlant": "Symbol_Firecracker",
	"DangleFruit":      "Symbol_DangleFruit",
	"BubbleGrass":      "Symbol_BubbleGrass",
	"SlimeMold":        "Symbol_SlimeMold",
	"Mushroom":         "Symbol_Mushroom",
	"JellyFish":        "Symbol_JellyFish",
	"VultureMask":      "Kill_Vulture",
	"VultureMask1":     "Kill_KingVulture",
	"VultureMask2":     "Symbol_ChieftainMask",
	"FlyLure":          "Symbol_FlyLure",
	"SLOracleSwarmer":  "Symbol_Neuron",
	"SSOracleSwarmer":  "Symbol_Neuron",
	"NSHSwarmer":       "Symbol_Neuron",
	"EggBugEgg":        "Symbol_EggBugEgg",
	"OverseerCarcass":  "Kill_Overseer",
	"DataPearl":        "Symbol_Pearl",
	"PebblesPearl":     "Symbol_Pearl",
	"NeedleEgg":        "needleEggSymbol",
	"Spearmasterpearl": "Symbol_Pearl",
	"HalcyonPearl":     "Symbol_Pearl",
	"EnergyCell":       "Symbol_EnergyCell",
	"GooieDuck":        "Symbol_GooieDuck",
	"GlowWeed":         "Symbol_GlowWeed",
	"LillyPuck":        "Symbol_LillyPuck",
	"DandelionPeach":   "Symbol_DandelionPeach",
	"MoonCloak":        "Symbol_MoonCloak",
	"FireEgg":          "Symbol_FireEgg",
	"JokeRifle":        "Symbol_JokeRifle",
	"Seed":             "Symbol_Seed",
	"SingularityBomb":  "Symbol_Singularity",
	"Default":          "Futile_White"
};

/**
 *	Convert item value string to HTML color.
 *	TODOs: same as creatureNameToIconAtlas().
 */
function itemNameToIconColor(type) {
	/*
	 *	Game extract: ItemSymbol::ColorForItem
	 *	Paste in verbatim, then make these changes:
	 *	- Adjust tabbing level to current scope
	 *	- Search and replace:
	 *		/itemType == AbstractPhysicalObject\.AbstractObjectType\./ --> "type == \""
	 *		/ModManager.MSC && itemType == MoreSlugcatsEnums.AbstractObjectType./ --> "type == \""
	 *		/\)\r\n\t{1,2}\{\r\n\t{2,3}/ --> "\"\)\r\n\t\t"
	 *		/\t{1,2}\}\r\n\t{1,2}if/ --> "\tif"
	 *		/ \|\| / --> "\" || "
	 *		/return new Color\(/ --> "c = ["
	 *		/\);\r\n\t+\}/ --> "];"
	 *		/return\s\(StaticWorld\.GetCreatureTemplate\(iconData\.critType\)\.breedParameters\sas\sLizardBreedParams\)\.standardColor;\r\n\t\}/ --> "c = standardColor\[type\];"
	 *	- ummm doing this one after creatureNameToIconColor, kinda don't care about exact refactoring notes
	 *	- For items with intData, append the value to type; these are enumerated individually
	 *	- except for PebblesPearl3 (includes any intData >= 3), PebblesPearl (intData < 0)
	 */
	var c = HSL2RGB(0.73055553, 0.08, 0.67);	//	Menu::MenuColors.MediumGrey
	if (type == "SporePlant")
		c = [0.68235296, 0.15686275, 0.11764706];
	if (type == "FirecrackerPlant")
		c = [0.68235296, 0.15686275, 0.11764706];
	if (type == "ScavengerBomb")
		c = [0.9019608, 0.05490196, 0.05490196];
	if (type == "Spear1")
		c = [0.9019608, 0.05490196, 0.05490196];
	if (type == "Spear2")
		c = [0, 0, 1];
	if (type == "Spear3")
		c = [1, 0.47058824, 0.47058824];
	if (type == "Lantern")
		c = [1, 0.57254905, 0.31764707];
	if (type == "FlareBomb")
		c = [0.73333335, 0.68235296, 1];
	if (type == "SlimeMold")
		c = [1, 0.6, 0];
	if (type == "BubbleGrass")
		c = [0.05490196, 0.69803923, 0.23529412];
	if (type == "DangleFruit")
		c = [0, 0, 1];
	if (type == "Mushroom")
		c = [1, 1, 1];
	if (type == "WaterNut")
		c = [0.05, 0.3, 0.7];
	if (type == "EggBugEgg")
		c = [0, 1, 0.47058824];
	if (type == "FlyLure")
		c = [0.6784314, 0.26666668, 0.21176471];
	if (type == "SSOracleSwarmer")
		c = [1, 1, 1];
	if (type == "NSHSwarmer")
		c = [0, 1, 0.3];
	if (type == "NeedleEgg")
		c = [0.5764706, 0.16078432, 0.2509804];
	if (type == "PebblesPearl1")
		c = [0.7, 0.7, 0.7];
	if (type == "PebblesPearl2")
		c = HSL2RGB(0.73055553, 0.08, 0.3);
	if (type == "PebblesPearl3")	//	intData >= 3
		c = [1, 0.47843137, 0.007843138];
	if (type == "PebblesPearl") 	//	intData < 0
		c = [0, 0.45490196, 0.6392157];
	if (type == "DataPearl" || itemType == "HalcyonPearl") {
		if (intData > 1 && intData < DataPearlList.length) {
				var mc = UniquePearlMainColor(intData);
				var hc = UniquePearlHighLightColor(intData);
				if (hc != null)
					mc = ColorScreen(mc, ColorQuickSaturation(hc, 0.5));
				else
					mc = ColorLerp(mc, [1, 1, 1], 0.15);
				if (mc[0] < 0.1 && mc[1] < 0.1 && mc[2] < 0.1)
					mc = ColorLerp(mc, HSL2RGB(0.73055553, 0.08, 0.67), 0.3);
				c = mc;
		} else if (intData == 1)
			c = [1, 0.6, 0.9];
		else
			c = [0.7, 0.7, 0.7];
	} else {
		if (type == "Spearmasterpearl")
			c = ColorLerp([0.45, 0.01, 0.04], [1, 1, 1], 0.15);
		if (type == "EnergyCell")
			c = [0.01961, 0.6451, 0.85];
		if (type == "SingularityBomb")
			c = [0.01961, 0.6451, 0.85];
		if (type == "GooieDuck")
			c = [0.44705883, 0.9019608, 0.76862746];
		if (type == "LillyPuck")
			c = [0.17058827, 0.9619608, 0.9986275];
		if (type == "GlowWeed")
			c = [0.94705886, 1, 0.26862746];
		if (type == "DandelionPeach")
			c = [0.59, 0.78, 0.96];
		if (type == "MoonCloak")
			c = [0.95, 1, 0.96];
		if (type == "FireEgg")
			c = [1, 0.47058824, 0.47058824];
	}
	return c;
}

/**
 *	Helper functions:
 *	Port of various functions to enumerate and calculate pearl colors.
 */
function makePearlColors() {
	for (var intData = 2; intData < DataPearlList.length; intData++) {
		var name = DataPearlList[intData];
		var mc = UniquePearlMainColor(intData);
		var hc = UniquePearlHighLightColor(intData);
		if (hc !== undefined)
			mc = ColorScreen(mc, ColorQuickSaturation(hc, 0.5));
		else
			mc = ColorLerp(mc, [1, 1, 1], 0.15);
		if (mc[0] < 0.1 && mc[1] < 0.1 && mc[2] < 0.1)
			mc = ColorLerp(mc, HSL2RGB(0.73055553, 0.08, 0.67), 0.3);
		var s = "\t\"" + name + "\": [";
		s += ((Math.round(mc[0] * 1e6) / 1e6).toString() + "       ").substring(0, 8);
		for (var i = 1; i < mc.length; i++)
			s += ", " + ((Math.round(mc[i] * 1e6) / 1e6).toString() + "       ").substring(0, 8);
		s += "],";
		console.log(s);
	}

	/**
	 *	From base game, DataPearl
	 *	s/DataPearl\.AbstractDataPearl\.DataPearlType\.|MoreSlugcatsEnums\.DataPearlType\./\"/
	 *	s/ \|\| /\" || /
	 *	s/\)\r\n\t+\{/\"\) \{/
	 *	etc.
	 */
	function UniquePearlMainColor(intData) {
		var pearlType = DataPearlList[intData];
		var c = [0.7, 0.7, 0.7];
		if (pearlType == "SI_west")
			c = [0.01, 0.01, 0.01];
		if (pearlType == "SI_top")
			c = [0.01, 0.01, 0.01];
		if (pearlType == "SI_chat3")
			c = [0.01, 0.01, 0.01];
		if (pearlType == "SI_chat4")
			c = [0.01, 0.01, 0.01];
		if (pearlType == "SI_chat5")
			c = [0.01, 0.01, 0.01];
		if (pearlType == "Spearmasterpearl")
			c = [0.04, 0.01, 0.04];
		if (pearlType == "SU_filt")
			c = [1, 0.75, 0.9];
		if (pearlType == "DM")
			c = [0.95686275, 0.92156863, 0.20784314];
		if (pearlType == "LC")
			c = HSL2RGB(0.34, 1, 0.2);
		if (pearlType == "LC_second")
			c = [0.6, 0, 0];
		if (pearlType == "OE")
			c = [0.54901963, 0.36862746, 0.8];
		if (pearlType == "MS")
			c = [0.8156863, 0.89411765, 0.27058825];
		if (pearlType == "RM")
			c = [0.38431373, 0.18431373, 0.9843137];
		if (pearlType == "Rivulet_stomach")
			c = [0.5882353, 0.87058824, 0.627451];
		if (pearlType == "CL")
			c = [0.48431373, 0.28431374, 1];
		if (pearlType == "VS")
			c = [0.53, 0.05, 0.92];
		if (pearlType == "BroadcastMisc")
			c = [0.9, 0.7, 0.8];
		if (pearlType == "CC")
			c = [0.9, 0.6, 0.1];
		if (pearlType == "DS")
			c = [0, 0.7, 0.1];
		if (pearlType == "GW")
			c = [0, 0.7, 0.5];
		if (pearlType == "HI")
			c = [0.007843138, 0.19607843, 1];
		if (pearlType == "LF_bottom")
			c = [1, 0.1, 0.1];
		if (pearlType == "LF_west")
			c = [1, 0, 0.3];
		if (pearlType == "SB_filtration")
			c = [0.1, 0.5, 0.5];
		if (pearlType == "SH")
			c = [0.2, 0, 0.1];
		if (pearlType == "SI_top")
			c = [0.01, 0.01, 0.01];
		if (pearlType == "SI_west")
			c = [0.01, 0.01, 0.01];
		if (pearlType == "SL_bridge")
			c = [0.4, 0.1, 0.9];
		if (pearlType == "SL_moon")
			c = [0.9, 0.95, 0.2];
		if (pearlType == "SB_ravine")
			c = [0.01, 0.01, 0.01];
		if (pearlType == "SU")
			c = [0.5, 0.6, 0.9];
		if (pearlType == "UW")
			c = [0.4, 0.6, 0.4];
		if (pearlType == "SL_chimney")
			c = [1, 0, 0.55];
		if (pearlType == "Red_stomach")
			c = [0.6, 1, 0.9];
		return c;
	}

	function UniquePearlHighLightColor(intData) {
		var pearlType = DataPearlList[intData];
		var c;
		if (pearlType == "SI_chat3")
			c = [0.4, 0.1, 0.6];
		if (pearlType == "SI_chat4")
			c = [0.4, 0.6, 0.1];
		if (pearlType == "SI_chat5")
			c = [0.6, 0.1, 0.4];
		if (pearlType == "Spearmasterpearl")
			c = [0.95, 0, 0];
		if (pearlType == "RM")
			c = [1, 0, 0];
		if (pearlType == "LC_second")
			c = [0.8, 0.8, 0];
		if (pearlType == "CL")
			c = [1, 0, 0];
		if (pearlType == "VS")
			c = [1, 0, 1];
		if (pearlType == "BroadcastMisc")
			c = [0.4, 0.9, 0.4];
		if (pearlType == "CC")
			c = [1, 1, 0];
		if (pearlType == "GW")
			c = [0.5, 1, 0.5];
		if (pearlType == "HI")
			c = [0.5, 0.8, 1];
		if (pearlType == "SH")
			c = [1, 0.2, 0.6];
		if (pearlType == "SI_top")
			c = [0.1, 0.4, 0.6];
		if (pearlType == "SI_west")
			c = [0.1, 0.6, 0.4];
		if (pearlType == "SL_bridge")
			c = [1, 0.4, 1];
		if (pearlType == "SB_ravine")
			c = [0.6, 0.1, 0.4];
		if (pearlType == "UW")
			c = [1, 0.7, 1];
		if (pearlType == "SL_chimney")
			c = [0.8, 0.3, 1];
		if (pearlType == "Red_stomach")
			c = [1, 1, 1];
		return c;
	}

	function ColorScreen(a, b) {
		return [1 - (1 - a[0]) * (1 - b[0]), 1 - (1 - a[1]) * (1 - b[1]), 1 - (1 - a[2]) * (1 - b[2])];
	}

	function ColorLerp(a, b, t) {
		return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
	}
	function ColorQuickSaturation(hc, value) {
		var a = QuickSaturation(hc) * value;
		return [hc[0] * a, hc[1] * a, hc[2] * a];
	}

	function QuickSaturation(col) {
		return InverseLerp(Math.max(...col), 0, Math.min(...col));
	}

	function InverseLerp(a, b, value) {
		var result;
		if (a != b)
			result = Math.min(Math.max((value - a) / (b - a), 0), 1);
		else
			result = 0;
		return result;
	}
}

//	Colored data pearl types, indexed by intData
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

const dataPearlToDisplayTextMap = {
	//	bingo, ChallengeUtils::NameForPearl()
	"CC":            "Gold",
	"DS":            "Bright Green",
	"GW":            "Viridian",
	"HI":            "Bright Blue",
	"LF_bottom":     "Bright Red",
	"LF_west":       "Deep Pink",
	"SH":            "Deep Magenta",
	"SI_chat3":      "Dark Purple",
	"SI_chat4":      "Olive Green",
	"SI_chat5":      "Dark Magenta",
	"SI_top":        "Dark Blue",
	"SI_west":       "Dark Green",
	"SL_bridge":     "Bright Purple",
	"SL_chimney":    "Bright Magenta",
	"SL_moon":       "Pale Yellow",
	"SB_filtration": "Teal",
	"SB_ravine":     "Dark Magenta",
	"SU":            "Light Blue",
	"UW":            "Pale Green",
	"VS":            "Deep Purple",
};

const dataPearlToColorMap = {
	"Misc":             [0.745,    0.745,    0.745   ],
	"Misc2":            [0.745,    0.745,    0.745   ],
	"CC":               [0.95,     0.8,      0.1     ],
	"SI_west":          [0.05125,  0.2575,   0.175   ],
	"SI_top":           [0.05125,  0.175,    0.2575  ],
	"LF_west":          [1,        0.15,     0.405   ],
	"LF_bottom":        [1,        0.235,    0.235   ],
	"HI":               [0.131863, 0.356863, 1       ],
	"SH":               [0.52,     0.08,     0.316   ],
	"DS":               [0.15,     0.745,    0.235   ],
	"SB_filtration":    [0.235,    0.575,    0.575   ],
	"SB_ravine":        [0.2575,   0.05125,  0.175   ],
	"GW":               [0.125,    0.775,    0.5625  ],
	"SL_bridge":        [0.58,     0.208,    0.93    ],
	"SL_moon":          [0.915,    0.9575,   0.32    ],
	"SU":               [0.575,    0.66,     0.915   ],
	"UW":               [0.49,     0.642,    0.49    ],
	"PebblesPearl":     [0.745,    0.745,    0.745   ],
	"SL_chimney":       [1,        0.105,    0.7075  ],
	"Red_stomach":      [0.6,      1,        0.9     ],
	"Spearmasterpearl": [0.496,    0.01,     0.04    ],
	"SU_filt":          [1,        0.7875,   0.915   ],
	"SI_chat3":         [0.175,    0.05125,  0.2575  ],
	"SI_chat4":         [0.175,    0.2575,   0.05125 ],
	"SI_chat5":         [0.2575,   0.05125,  0.175   ],
	"DM":               [0.963333, 0.933333, 0.326667],
	"LC":               [0.15,     0.49,     0.1636  ],
	"OE":               [0.616667, 0.463333, 0.83    ],
	"MS":               [0.843333, 0.91,     0.38    ],
	"RM":               [0.692157, 0.184314, 0.984314],
	"Rivulet_stomach":  [0.65,     0.89,     0.683333],
	"LC_second":        [0.76,     0.4,      0       ],
	"CL":               [0.742157, 0.284314, 1       ],
	"VS":               [0.765,    0.05,     0.96    ],
	"BroadcastMisc":    [0.911111, 0.775,    0.822222]
};

const itemNameToIconColorMap = {
	"Default":                [0.66384,  0.6436,   0.6964  ],
	"SporePlant":             [0.682353, 0.156862, 0.117647],
	"FirecrackerPlant":       [0.682353, 0.156862, 0.117647],
	"ScavengerBomb":          [0.90196,  0.054902, 0.054902],
	"Spear1":                 [0.90196,  0.054902, 0.054902],
	"Spear2":                 [0,        0,        1       ],
	"Spear3":                 [1,        0.470588, 0.470588],
	"Lantern":                [1,        0.572549, 0.317647],
	"FlareBomb":              [0.733333, 0.682353, 1       ],
	"SlimeMold":              [1,        0.6,      0       ],
	"BubbleGrass":            [0.054902, 0.698039, 0.235294],
	"DangleFruit":            [0,        0,        1       ],
	"Mushroom":               [1,        1,        1       ],
	"WaterNut":               [0.05,     0.3,      0.7     ],
	"EggBugEgg":              [0,        1,        0.470588],
	"FlyLure":                [0.678431, 0.266667, 0.211765],
	"SSOracleSwarmer":        [1,        1,        1       ],
	"NSHSwarmer":             [0,        1,        0.3     ],
	"NeedleEgg":              [0.57647,  0.160784, 0.25098 ],
	"PebblesPearl1":          [0.7,      0.7,      0.7     ],
	"PebblesPearl2":          [0.2944,   0.276,    0.324   ],
	"PebblesPearl3":          [1,        0.478431, 0.007843],
	"PebblesPearl":           [0,        0.454902, 0.639216],
	"DataPearl":              [0.7,      0.7,      0.7     ],	//	default values -- access special values by using key:
	"HalcyonPearl":           [0.7,      0.7,      0.7     ],	//	"Pearl" + DataPearlList[intData]
	"DataPearl1":             [1,        0.6,      0.9     ],	//	intData = 1
	"Spearmasterpearl":       [0.5325,   0.1585,   0.184   ],
	"EnergyCell":             [0.01961,  0.6451,   0.85    ],
	"SingularityBomb":        [0.01961,  0.6451,   0.85    ],
	"GooieDuck":              [0.447059, 0.90196,  0.768627],
	"LillyPuck":              [0.170588, 0.96196,  0.998627],
	"GlowWeed":               [0.947059, 1,        0.268627],
	"DandelionPeach":         [0.59,     0.78,     0.96    ],
	"MoonCloak":              [0.95,     1,        0.96    ],
	"FireEgg":                [1,        0.470588, 0.470588],
	//	Prepend "Pearl_" to a special DataPearl type to access its color
	"Pearl_Misc":             [0.745,    0.745,    0.745   ],
	"Pearl_Misc2":            [0.745,    0.745,    0.745   ],
	"Pearl_CC":               [0.95,     0.8,      0.1     ],
	"Pearl_SI_west":          [0.05125,  0.2575,   0.175   ],
	"Pearl_SI_top":           [0.05125,  0.175,    0.2575  ],
	"Pearl_LF_west":          [1,        0.15,     0.405   ],
	"Pearl_LF_bottom":        [1,        0.235,    0.235   ],
	"Pearl_HI":               [0.131863, 0.356863, 1       ],
	"Pearl_SH":               [0.52,     0.08,     0.316   ],
	"Pearl_DS":               [0.15,     0.745,    0.235   ],
	"Pearl_SB_filtration":    [0.235,    0.575,    0.575   ],
	"Pearl_SB_ravine":        [0.2575,   0.05125,  0.175   ],
	"Pearl_GW":               [0.125,    0.775,    0.5625  ],
	"Pearl_SL_bridge":        [0.58,     0.208,    0.93    ],
	"Pearl_SL_moon":          [0.915,    0.9575,   0.32    ],
	"Pearl_SU":               [0.575,    0.66,     0.915   ],
	"Pearl_UW":               [0.49,     0.642,    0.49    ],
	"Pearl_PebblesPearl":     [0.745,    0.745,    0.745   ],
	"Pearl_SL_chimney":       [1,        0.105,    0.7075  ],
	"Pearl_Red_stomach":      [0.6,      1,        0.9     ],
	"Pearl_Spearmasterpearl": [0.496,    0.01,     0.04    ],
	"Pearl_SU_filt":          [1,        0.7875,   0.915   ],
	"Pearl_SI_chat3":         [0.175,    0.05125,  0.2575  ],
	"Pearl_SI_chat4":         [0.175,    0.2575,   0.05125 ],
	"Pearl_SI_chat5":         [0.2575,   0.05125,  0.175   ],
	"Pearl_DM":               [0.963333, 0.933333, 0.326667],
	"Pearl_LC":               [0.15,     0.49,     0.1636  ],
	"Pearl_OE":               [0.616667, 0.463333, 0.83    ],
	"Pearl_MS":               [0.843333, 0.91,     0.38    ],
	"Pearl_RM":               [0.692157, 0.184314, 0.984314],
	"Pearl_Rivulet_stomach":  [0.65,     0.89,     0.683333],
	"Pearl_LC_second":        [0.76,     0.4,      0       ],
	"Pearl_CL":               [0.742157, 0.284314, 1       ],
	"Pearl_VS":               [0.765,    0.05,     0.96    ],
	"Pearl_BroadcastMisc":    [0.911111, 0.775,    0.822222]
};
