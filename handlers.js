document.addEventListener("DOMContentLoaded", function() {
	//	Set up DOM elements and listeners

	//	Nav, header and file handling buttons
	document.getElementById("hdrshow").addEventListener("click", clickShowPerks);
	document.getElementById("boardcontainer").addEventListener("click", clickBoard);
	document.getElementById("boardcontainer").addEventListener("keydown", navSquares);

	document.getElementById("kibitzing").addEventListener("input", toggleKibs);
	document.getElementById("transp").addEventListener("input", toggleTransp);
	document.getElementById("textbox").addEventListener("paste", pasteText);
	document.getElementById("clear").addEventListener("click", clearText);
	document.getElementById("parse").addEventListener("click", parseText);
	document.getElementById("parse").addEventListener("click", redrawBoard.bind(this, "board", board));
	document.getElementById("copy").addEventListener("click", copyText);

	document.getElementById("fileload").addEventListener("change", (e) => doLoadFile(e.target.files));
	var d = document.getElementById("droptarget");
	d.addEventListener("dragenter", dragEnterOver);
	d.addEventListener("dragover", dragEnterOver);
	d.addEventListener("dragleave", dragLeave);
	d.addEventListener("drop", dragDrop);

	//	Other housekeeping
	kibitzing = !!document.getElementById("kibitzing").checked;
	transpose = !!document.getElementById("transp").checked;
});

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
		if (transpose) {
			var t = y; y = x; x = t;
		}
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
			if (transpose) {
				var t = dCol; dCol = dRow; dRow = t;
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
 *	Kibitzing check toggled.
 */
function toggleKibs(e) {
	kibitzing = e.target.checked;
	if (selected !== undefined)
		selectSquare(selected.col, selected.row);
}

/**
 *	Transpose check toggled.
 */
function toggleTransp(e) {
	transpose = e.target.checked;
	redrawBoard();
	if (selected !== undefined)
		selectSquare(selected.col, selected.row);
}

/**
 *	Pasted to textbox.
 */
function pasteText(e) {
	//	Let default happen, but trigger a parse in case no edits are required by the user
	setTimeout((e) => {parseText(e); redrawBoard();}, 10);
}

/**
 * Clicked on Clear.
 */
function clearText(e) {
	document.getElementById("textbox").value = "";
	var u = new URL(document.URL);
	u.search = "";
	window.history.pushState(null, "", u.href);
}

/**
 *	Parse Text button pressed.
 */
function parseText(e) {
	var s = document.getElementById("textbox").value;
	s = s.trim().replace(/\s*bChG\s*/g, "bChG");
	document.getElementById("textbox").value = s;
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
	//	assertion: no challenge names are shorter than 14 chars (true as of 1.25)
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
					board.goals.push(CHALLENGES[type](desc, board.character));
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

	//	Fill meta table with board info
	setHeaderFromBoard(board);

	//	prepare board binary encoding
	board.toBin = boardToBin(board);
	s = binToBase64u(board.toBin);
	var u = new URL(document.URL);
	u.searchParams.set("b", s);
	window.history.pushState(null, "", u.href);

	if (selected !== undefined)
		selectSquare(selected.col, selected.row);

}

/**
 *	Clicked on Copy.
 */
function copyText(e) {
	navigator.clipboard.writeText(document.getElementById("textbox").value);
	setError("Text copied to clipboard.");
}

function doLoadFile(files) {
	for (var i = 0; i < files.length; i++) {
		if (files[i].type.match("^text/plain")) {
			var fr = new FileReader();
			fr.onload = function() {
				document.getElementById("textbox").value = this.result;
				parseText();
				redrawBoard();
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
 * Element dragged over drop target.
 */
function dragEnterOver(e) {
	if (e.dataTransfer.types.includes("text/plain")
			|| e.dataTransfer.types.includes("Files")) {
		e.preventDefault();
		e.target.style.backgroundColor = "#686868";
	}
}

/**
 * Element dragged away from drop target.
 */
function dragLeave(e) {
	// maybe :-moz-drag-over css pseudoclass will one day be standard. that'd be handy in this situation.
	e.target.style.backgroundColor = "";
}

/**
 *	Data dropped onto the page.
 */
function dragDrop(e) {
	e.preventDefault();
	e.target.style.backgroundColor = "";
	var d = e.dataTransfer;
	setError("");
	if (d.types.includes("Files")) {
		doLoadFile(d.files);
	} else {
		var s;
		for (var i = 0; i < d.items.length; i++) {
			if (d.items[i].type.match("^text/plain")) {
				d.items[i].getAsString(function(s) {
					document.getElementById("textbox").value = s;
					parseText();
					redrawBoard();
				});
				return;
			}
		}
		setError("Please drop a text file.");
	}
}
