# Bingovista
Board viewer for Rain World Bingo mod.

Description and usage are shown on the [main page](https://t3sl4co1l.github.io/bingovista/bingovista.html#about).  This file serves to cover technical aspects, usage, and design and development of the project generally.

## Architecture
...There isn't, really. :woozy_face: Yet.

I mean it's not bad for what it is (was / has been), but, I'll explain by way of history, then what it's headed towards.

### Background

Original design is a "simple" single-page web app, that users can paste a text string into, get a sharable URL out, and show the board more-or-less as seen in-game.  Details and commentary can also be viewed on the goals.

After gathering over some 900 or so enums, gathering sprites and map data, partially porting over code from the 40-some odd BingoChallenge classes, and writing various supporting code (not to mention, crafting a [binary file format](format.txt) (format.txt hasn't been updated in a while, so it's a bit incomplete versus current state of development, but illustrates the design concept), this simple little project burgeoned into a 6kLOC 250kB monolith of Javascript.  Frankly I'm impressed I've managed to create and maintain such a beast, so there's that...

The other driving goal (other than the base functions) was to validate and error-report anything out of order.  This is for two reasons:

0. *Never trust user input*. Text is highly variable, and parsing is open to ambiguity.  Better to error out than accept something that might cause issues down the processing chain.\*  This is a universal principle, not unique to this project; I consider it a zeroth rule.
1. Mod versions up to v1.1 or so, had a bug where, if a parameter had an inappropriate value, then editing that parameter would cause the UI to crash (uncaught game thread exception, I believe it was?).  The mod would work otherwise (no problems for clients or gameplay).  Boards that were stored and shared through this app, would then be validated against what's safe for the mod to consume.

\*Subsequent processing is mostly error-tolerant, but not controlled for.  For example, erroneous input might result in uncaught exceptions (e.g. referencing an `undefined` object member), default values, placeholders, or silent errors (for example, nonexistent sprites return a solid-color square -- which isn't original design but follows from the game's implementation).  As a design principle, errors should air on the side of visibility: easily identifiable and traceable, without hampering user experience.  For user-defined data sources, where nonsensical input or unrecoverable error occurs, a visible error is acceptable (e.g. error goal); otherwise, throws or `console.log`s are nice.

Also, not that validation exactly matters to a client-side app, by itself, but having some visibility into how board strings are stored, shared, and mutated (as it turns out, during the tournament, board designers got pretty clever!), is useful for broader purposes.  For example, the link shortener backend needs enough validation to trust a submission, but not so much that it's totally inflexible (or incurs bugs!).  Mod devs may also benefit from these insights.

### Compatibility

1. This app shall mimic the behavior and appearance of Bingo Mod.  The board view recreates the static in-game view (over a solid black background).  Transparency, mouse-over, RW-style cursors/highlights, and the lobby view, can be considered optional aspects.  Rounding errors (in position, scale, color, etc.), minor color palette errors, antialiasing discrepancies, etc. are acceptable.  Goals with icons and/or text out of order, text mismatched, incorrect or broken icons, etc. are bugs and should be reported (please include screenshots of in-game and Bingovista boards, and a copy of the board text string).
2. This app shall be fully backwards-compatible: board (text) string, or encoded data, from all versions, will be read without error, to as close an approximation to modern format as is possible.  Where backwards compatibility is not possible, Bingo Mod takes priority (e.g. the v1.25 transposition).  (If possible, a compatibility option should be implemented to support both versions visually.)
3. Output from this app shall target current version Bingo Mod.  Versioned or backwards-compatible output is not required.

This maximizes preservation of external, serialized data -- anything copied out of the game, stored, or modified by this app.  Not a huge priority for something incidental, for-fun like this, but a step that should be simple enough to provide.  It's another general principle: anything that is within dev scope to control, open season; anything outside of control, tread very carefully and ensure a route for users to access and view their data.

### Operation

(This description applies mostly to @d4e78d60feb5c405a9c22ae4faf2275bb27dd3e2 ; newer commits are starting to change.  See below.)

Main operation for the viewer, executes through startup and event functions: `DOMContentLoaded` listener, or `parseText()` on clicking the Parse button.  Other events process single goals (`clickBoard()`, `selectSquare()`), update DOM content (`redrawBoard()`), or other UI stuff (`navSquares()`, `dragDrop()`, `doLoadFile()`), etc..  Currently, `parseText()` does all the, well, parsing, and DOM updates.

Four data sources are implemented:
1. Plain text in the URL (not actually intended to be used, lol)
2. base64 in URL, via `base64uToBin()`
3. Shortened URL, via `fetch(<shortener server>)`
4. Plain text entered into `textbox`

Binary sources are parsed with `binToString()`, which outputs plain text.  No abstract board data are produced at this time.  (This adds execution overhead -- text error checking on this path is redundant -- but was chosen to reduce implementation overhead and avoid bugs due to code duplication.)  Text is needed anyway, so a viewer can copy it from `textbox` into the game.

`binToString()` parses the header, then iterates `binGoalToText()`, using the substitution maps in `BINARY_TO_STRING_DEFINITIONS[]`.  Most goals use numeric parameters, or are keyed from enums (which are reduced to integer indices); few use lists (enum keyed, so stored as an integer array), or plain UTF-8 strings (fixed-length, or zero-terminated).  Enums include goals themselves (via `BingoEnum_CHALLENGES[]` or `challengeValue()`).  A goal, as a type, includes its enum value (and index), and a fixed set of parameters.  Updated versions are therefore implemented by appending goal decoders to the list (named with an `Ex`, `Ex2`, etc. suffix).

(If you're curious, as a compression method, this scheme outperforms a general compressor like ZIP by about 2-3x.  It still leaves about a factor of 2-3 on the table -- intentionally, for ease of implementation, and room for future expansion.  Huffman encoding could be layered on top for about a ~2x improvement, but doesn't seem worthwhile.)

Whatever the original source, `parseText()` parses the text into an abstract board object stored in global `board`.  `CHALLENGES[]` is keyed by goal name, and outputs everything required (descriptive text, graphics, binary).  `boardToBin()` is called at the end, to concatenate the binary goals, ultimately to set the URL (regardless of whether the original data source was binary).

At the bottom, some helper functions are provided.  These aren't used in normal execution, but are useful for testing and demonstration:
- `setMeta()` to set header (meta) data more easily (from the console; in lieu of a user-friendly process at the moment)
- `enumeratePerks()` reads perk selection from DOM
- `compressionRatio()` calculates the compression from text to binary for the current `board`
- `countGoalOptions(g)` counts the number of possible values/options for a (binary) goal
- `goalFromNumber(g, n)` creates a goal (integer type g) from a floating-point number 0 <= n < 1, reading the number as an arithmetic encoding of the goal's parameters
- `generateRandomGoals(g, n)` generates n random goals of goal type g (integer)
- `generateRandomRandomGoals(n)` generates n random goals of random type
- `generateOneOfEverything()` generates a random goal of each type

### Plans

After a successful run (up to and through) [Bingo 6: Survival of the Sluggiest](https://www.youtube.com/@RainWorldEvents), ambitious plans were made:
- Moving to a mutable object model, where a goal object can be constructed from either (binary or text) input, and generate either output, and formatted text/graphics.
- Refactoring out `CHALLENGES`. Instructions to construct a goal object, will be encoded in (what is currently) `BINARY_TO_STRING_DEFINITIONS[]`, putting all I/O for a goal in the same place. This will probably still include function stubs (where custom logic, inputters or outputters are needed), but that's okay.
- Move to a "create" / "view" usage model, splitting the app across a couple HTML pages.  The common JS module runs both, either adaptively (detects whichever one it's running in) or by configuration (presets in global context, or loading it as a module proper).

New applications are beginning to show interest.  GreatGameDota's [Live Board Viewer](https://github.com/GreatGameDota/live-board-viewer-rw-mod) uses the module to transform and view text-format board status (broadcast ~real time from a remote server).  Gzethicus is developing a [board repo](https://github.com/Gzethicus/bingo_repo).  Moving to a module format will greatly help with such usage.

And, some time, eventually, modpacks are...a thought.  Design should leave open the future possibility.  This may come sooner than later, with interesting Watcher Bingo growing.

Current mod support intent would be something like: loading a module (JSON?), that contains elements to extend enums (e.g. adding to `creatures` and `items` -- and any action-specific lists those entities also belong to e.g. `weapons`, `craft`, etc.), `atlases` (for any added sprites -- with graphics probably encoded as base64 data URL in PNG format, for example), and any brand new functions to implement new goals or other extensions (which will have to be via `new Function(string)` -- or a parser written for purpose; I'd just as well require modpacks to be vetted, so that importing raw code isn't quite as onerous, since the alternative is *much* more complicated).  So, basically: allow that enums may expand during startup, and, maybe reset by clearing and loading new mods or something (perhaps refreshing the board automatically when changes are made), and, that should be it.

### Status
A few functions have been refactored to an intermediate structure: `BingoAchievementChallenge`, `BingoAllRegionsExcept`, and `BingoDamageChallenge`.  These use new functions `upgradeDescriptor()` and `challengeTextToAbstract()` to transform and parse the parameter list, which will eventually be used by `parseText()` directly.  The local objects `upgrades`, `template`, and functions `xxxChallengePaint()` (and `Description`, `Comment` and `ToBinary`), will be moved to `BINARY_TO_STRING_DEFINITIONS[]`, at which point the `CHALLENGES[]` functions are empty stubs and can be removed entirely, and goals will be fully specified in one location.  Finally, `BINARY_TO_STRING_DEFINITIONS` would get renamed to something like `CHALLENGE_DESCRIPTORS`.

At some point, the Bingovista-specific UI and usage stuff might be spun off into its own .js, while the core stuff becomes the first module proper.  Exports for most enum objects and functions will remain accessible for external customization.

## Known Dev-Side Issues
1. Local instance doesn't load sprites.  Firefox throws the exception: `Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at file:/// ...`, and similar for Chrome, etc..  Yeah, very minor and typical problem.  Standard workaround: 1. ignore the colored squares; 2. host on a local server.
2. Should probably be docs, as such, at some point?  Will see as `module`ization goes on.  This readme at least gives something of a start.
3. Testing would also be nice.  Intentionally-erroneous board data (and which errors they should throw), as well as scripts exploring typical and edge cases for API calls (when such time as an API exists..?), would be useful.

## Testing, Docs, Extras

[boards.txt](boards.txt) contains a few :slightly_smiling_face: boards for reference, testing, etc.  Some are silly, some are pieced together, some are impossible, some are absurdly oversized (did you know? All unlocks just fit on a 11x11 grid!), some are randomly generated (in-game or via Bingovista tools), and many are actual boards played.  Each has a text comment above the viewer URL, then the board string.  Groups are separated by double newlines.  Comments are (generally) of the format: campaign; creator; notes, who played on it, when it was created, etc.

[format.txt](format.txt) documents the binary board format, at least in terms of initial design.

C implementations for reading `boards.txt`, and the binary format, also exist (available on request; they aren't a part of any public repo at this time).

## Contributing

Pull requests are welcome.

AI generated content is not welcome.  If changes are small, whatever, who knows I guess, but basically: if you can't explain the proposed changes, I'm not interested.

Not interested in non-track major overhauls: in analogy to the phrase "extraordinary claims require extraordinary proof", major changes require major testing, and major explanation.  Which takes more work on your part, and more work on mine to make sense of it.  Incremental development is boring, but a path is known, and boring is easy.  (Development should be easy, yeah?)
