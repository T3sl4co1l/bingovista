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
	document.getElementById("parse").addEventListener("click", parseButton);
	document.getElementById("copy").addEventListener("click", copyText);

	document.getElementById("fileload").addEventListener("change", (e) => doLoadFile(e.target.files));
	var d = document.getElementById("droptarget");
	d.addEventListener("dragenter", dragEnterOver);
	d.addEventListener("dragover", dragEnterOver);
	d.addEventListener("dragleave", dragLeave);
	d.addEventListener("drop", dragDrop);

	//	Other housekeeping
	kibitzing = document.getElementById("kibitzing").checked;
	transpose = document.getElementById("transp").checked;
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
		const canvas = e.target;
		var goalSquare = {}; Object.assign(goalSquare, square)
		goalSquare.margin = Math.max(Math.round((canvas.width + canvas.height) * 2 / ((parseInt(canvas.dataset.width) + parseInt(canvas.dataset.height)) * 91)) * 2, 2);
		goalSquare.width = Math.round((canvas.width / parseInt(canvas.dataset.width)) - goalSquare.margin - goalSquare.border);
		goalSquare.height = Math.round((canvas.height / parseInt(canvas.dataset.height)) - goalSquare.margin - goalSquare.border);

		var rect = canvas.getBoundingClientRect();
		var x = Math.floor(e.clientX - Math.round(rect.left)) - (goalSquare.border + goalSquare.margin) / 2;
		var y = Math.floor(e.clientY - Math.round(rect.top )) - (goalSquare.border + goalSquare.margin) / 2;
		if (transpose) {
			var t = y; y = x; x = t;
		}
		var sqWidth = goalSquare.width + goalSquare.margin + goalSquare.border;
		var sqHeight = goalSquare.height + goalSquare.margin + goalSquare.border;
		var col = Math.floor(x / sqWidth);
		var row = Math.floor(y / sqHeight);
		if (x >= 0 && y >= 0 && (x % sqWidth) < (sqWidth - goalSquare.margin)
				&& (y % sqHeight) < (sqHeight - goalSquare.margin)) {
			selectSquare(col, row, canvas.id);
		} else {
			selectSquare(-1, -1, canvas.id);
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
			selectSquare(col, row, e.target.id);
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
	setTimeout(parseButton, 10);
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
function parseButton(e) {

	var s = document.getElementById("textbox").value;
	s = s.replace(/;\n+/, ";");
	s = s.trim().replace(/\s*bChG\s*/g, "bChG");
	board = parseText(s);
	document.getElementById("textbox").value = s;

	//	Parse meta from the document, if not already set
	if (board.comments === "")
		board.comments = document.getElementById("hdrttl")?.innerText || "Untitled";
	if (board.character === "")
		board.character = document.getElementById("hdrchar")?.innerText || "Any";
	if (board.shelter === "")
		board.shelter = document.getElementById("hdrshel")?.innerText || "";
	if (board.shelter === "random") board.shelter = "";
	if (board.perks === undefined) {
		board.perks = 0;
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
	}
	//	Refresh meta table (parameters that weren't overwritten here)
	setHeaderFromBoard(board);
	//	And refresh bin, now that we've changed it
	board.toBin = boardToBin(board);

	//	Adjust graphical dimensions based on canvas and board sizes
	var canv = document.getElementById("board");
	square.margin = Math.max(Math.round((canv.width + canv.height) * 2 / ((board.width + board.height) * 91)) * 2, 2);
	square.width = Math.round((canv.width / board.width) - square.margin - square.border);
	square.height = Math.round((canv.height / board.height) - square.margin - square.border);

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

	redrawBoard();

	var u = new URL(document.URL);
	u.searchParams.set("b", binToBase64u(board.toBin));
	window.history.pushState(null, "", u.href);

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
				parseButton();
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
					parseButton();
				});
				return;
			}
		}
		setError("Please drop a text file.");
	}
}
