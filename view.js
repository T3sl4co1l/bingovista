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
	u.searchParams.set("b", Bingovista.binToBase64u(this.board.toBin));
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
