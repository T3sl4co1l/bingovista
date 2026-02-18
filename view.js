var bv;

document.addEventListener("DOMContentLoaded", function() {
	//	Set up DOM elements and listeners

	document.getElementById("boardcontainer").innerHTML = "Load a board...";
	bv = new Bingovista( {
		headerId: "header",
		boardId: "boardcontainer",
		selectId: "descsq",
		detailId: "desctxt",
		cursor: true,
		tips: document.getElementById("kibitzing").checked,
		transpose: document.getElementById("transp").checked,
		loadFail: loadFail,
		loadSuccess: loadSuccess,
	} );
	
	bv.selectSquare = mySelectSquare;

	//	Nav, header and file handling buttons
	document.getElementById("boardcontainer").addEventListener("keydown", navSquares);
	document.getElementById("kibitzing").addEventListener("input", toggleKibs);
	document.getElementById("transp").addEventListener("input", toggleTransp);
	document.getElementById("copy").addEventListener("click", copyText);

	var u = new URL(document.URL).searchParams;
	var flag = false;
	if (u.has("a")) {
		//	Plain text / ASCII string
		//	very inefficient, unlikely to be used, but provided for completeness
		bv.setup( { dataSrc: u.get("a"), dataType: "text" } );
		flag = true;
	} else if (u.has("b")) {
		//	Binary string, base64 encoded
		bv.setup( { dataSrc: u.get("b"), dataType: "base64" } );
		flag = true;
	} else if (u.has("q")) {
		//	Query, Bingovista will fetch from remote server to get board data
		bv.setup( { dataSrc: u.get("q"), dataType: "short" } );
		flag = true;
	}
	//	hack to uppercase perks button consistent with create
	if (flag)
		document.getElementById("header").children[0].children[0].children[4]
				.children[1].children[0].children[0].value = "SHOW/HIDE";
});

/**
 *	Data loaded callback.
 */
function loadSuccess(e) {
	document.getElementById("errorbox").style.display = "none";
	document.getElementById("textbox").value = this.board.text;
	var u = new URL(document.URL);
	u.searchParams.set("b", Bingovista.binToBase64u(this.board.bin));
	u.searchParams.delete("q");
	document.getElementById("permlink").value = u.href;
}

/**
 *	Data load failure callback.
 */
function loadFail(e) {
	var e = document.getElementById("errorbox");
	e.style.display = "initial";
	e.innerHTML = "Status: " + this.board.error;
}

/**
 *	Key input to board container; pare down to arrow keys for navigating squares
 */
function navSquares(e) {
	if (bv !== undefined && e.target.id === "boardcontainer") {
		var col = 0, row = 0;
		if (e.key === "Left"  || e.key === "ArrowLeft" ) col = -1;
		if (e.key === "Right" || e.key === "ArrowRight") col = 1;
		if (e.key === "Up"    || e.key === "ArrowUp"   ) row = -1;
		if (e.key === "Down"  || e.key === "ArrowDown" ) row = 1;
		if (col || row) {
			e.preventDefault();
			if (bv.selected?.col === undefined || bv.selected?.row === undefined)
				bv.selected = { col: 0, row: 0 };
			if (bv.selected.col < 0 || bv.selected.col >= bv.board.width ) bv.selected.col = 0;
			if (bv.selected.row < 0 || bv.selected.row >= bv.board.height) bv.selected.row = 0;
			col += bv.selected.col; row += bv.selected.row;
			if (row < 0) row += bv.board.height;
			if (row >= bv.board.height) row -= bv.board.height;
			if (col < 0) col += bv.board.width;
			if (col >= bv.board.width) col -= bv.board.width;
			bv.selectSquare(col, row);
		}
	}
}

/**
 *	Kibitzing check toggled.
 */
function toggleKibs(e) {
	bv?.setup( { tips: e.target.checked } );
}

/**
 *	Transpose check toggled.
 */
function toggleTransp(e) {
	bv?.setup( { transpose: e.target.checked } );
}

/**
 *	Clicked on Copy.
 */
function copyText(e) {
	navigator.clipboard.writeText(document.getElementById("textbox").value);
}

function mySelectSquare(col, row) {
	var ctx, elem, goal, width, height;
	this.selected = { col: col, row: row };
	this.setCursor(col, row);
	if (this.selectId !== undefined) {
		elem = document.getElementById(this.selectId);
		if (elem !== null) {
			var canv = elem.children[0];
			if (canv === undefined || canv.getContext === undefined) {
				//	hierarchy not as expected; rip out and start over
				//	(note: leaks any attached listeners)
				while (elem.childNodes.length) elem.removeChild(elem.childNodes[0]);
				canv = document.createElement("canvas");
				//	Get size from container element; if unrealistic, set the internal default
				elem.setAttribute("class", "bv-select");
				canv.setAttribute("class", "bv-selectcanv");
				canv.width  = Math.round(elem.getBoundingClientRect().width ) - 2;
				canv.height = Math.round(elem.getBoundingClientRect().height) - 2;
				if (canv.width < 32 || canv.height < 32) {
					//	parent dimensions may be unset; use BV default
					canv.width = 100; canv.height = 100;
				}
				elem.appendChild(canv);
			}
			ctx = canv.getContext("2d");
			ctx.fillStyle = this.square.background;
			ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
			if (col >= 0 && col < this.board.width && row >= 0 && row <= this.board.height
					&& this.getGoal(col, row) !== undefined) {
				this.drawSquare("select", this.getGoal(col, row));
			}
		}
	}

	if (this.detailId === undefined) return;
	elem = document.getElementById(this.detailId);
	if (elem === null) return;
	elem.setAttribute("class", "bv-desctxt");
	if (!(col >= 0 && row >= 0 && col < this.board.width && row <= this.board.height
			&& this.getGoal(col, row) !== undefined)) {
		while (elem.childNodes.length) elem.removeChild(elem.childNodes[0]);
		elem.appendChild(document.createTextNode(this.unselectText));
		return;
	}
	goal = this.getGoal(col, row);
	while (elem.childNodes.length) elem.removeChild(elem.childNodes[0]);
	var el2 = document.createElement("div");
	el2.setAttribute("class", "bv-descch");
	el2.appendChild(document.createTextNode("Challenge: " + goal.category));
	elem.appendChild(el2);
	el2 = document.createElement("div");
	el2.setAttribute("class", "bv-descdesc");
	//	If content is "trusted", let it use HTML; else, escape it because it contains board text that'll be misinterpreted as HTML
	if (goal.name === "BingoChallenge")
		el2.appendChild(document.createTextNode(goal.description));
	else
		el2.innerHTML = goal.description;
	elem.appendChild(el2);
	el2 = document.createElement("table");
	el2.setAttribute("class", "bv-desclist");
	var tbh = document.createElement("thead");
	var tr = document.createElement("tr");
	var td = document.createElement("td");
	td.appendChild(document.createTextNode("Parameter"));
	tr.appendChild(td);
	td = document.createElement("td");
	td.appendChild(document.createTextNode("Value"));
	tr.appendChild(td);
	tbh.appendChild(tr);
	tbh = document.createElement("tbody");
	if (goal.name === "BingoVistaChallenge") {
		for (var i = 0; i < goal.items.length && i < goal.values.length; i++) {
			if (goal.items[i].length > 0 && goal.items[i] !== "room" && goal.items[i] !== "x" && goal.items[i] !== "y") {
				tr = document.createElement("tr");
				td = document.createElement("td");
				td.appendChild(document.createTextNode(goal.items[i]));
				tr.appendChild(td);
				td = document.createElement("td");
				td.appendChild(document.createTextNode(goal.values[i]));
				td.style.wordWrap = "anywhere";
				tr.appendChild(td);
				tbh.appendChild(tr);
			}
		}
	} else {
		for (var i = 0; i < goal.items.length && i < goal.values.length; i++) {
			if (goal.items[i].length > 0) {
				tr = document.createElement("tr");
				td = document.createElement("td");
				td.appendChild(document.createTextNode(goal.items[i]));
				tr.appendChild(td);
				td = document.createElement("td");
				td.appendChild(document.createTextNode(goal.values[i]));
				td.style.wordWrap = "anywhere";
				tr.appendChild(td);
				tbh.appendChild(tr);
			}
		}
	}
	el2.appendChild(tbh);
	elem.appendChild(el2);
	if (this.tipsEnabled && goal.comments.length > 0) {
		el2 = document.createElement("div"); el2.setAttribute("class", "bv-desccomm");
		el2.innerHTML = goal.comments;
		elem.appendChild(el2);
	}

}
