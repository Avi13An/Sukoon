const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'node_modules', 'react-native-track-player', 'android', 'src', 'main', 'java', 'com', 'doublesymmetry', 'trackplayer', 'module', 'MusicModule.kt');

let content = fs.readFileSync(file, 'utf8');

// The methods might have `@ReactMethod` on the previous line or same line.
// Let's replace `= scope.launch {` with `{ scope.launch {`
// But we also need to append an extra `}` at the end of the block.
// This is tricky using pure regex because we need to balance the braces.
// Alternatively, since Kotlin allows:
// fun getTrack() { scope.launch { ... } }
// But wait! If we just replace `= scope.launch {` with `{ scope.launch {`, we MUST add the closing `}` at the end of the function.
// Since we have the exact line numbers from findstr, wait, we can just replace:
// `fun (.*) = scope.launch \{`
// with `fun $1 { scope.launch {`
// And how do we add the closing `}`?
// What if we do: `fun getTrack(...) = scope.launch {` to `fun getTrack(...) { scope.launch {` 
// Actually, an easier fix: 
// `@ReactMethod(isBlockingSynchronousMethod = false)` or just `@ReactMethod`
// React Native TurboModule crash is because of the return type of the method.
// We can just explicitly declare the return type! No, expression bodies infer the return type.
// If we add `: Unit` before `= scope.launch`, it might compile? No, `scope.launch` returns a `Job`, not `Unit`.
// To return `Unit`, it must be a block body.

// Let's write a parser to find the matching closing brace.
function fixFile() {
    let lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('= scope.launch {')) {
            // Replace with block
            lines[i] = line.replace('= scope.launch {', '{ scope.launch {');
            // Now find the matching brace for `scope.launch {`
            let braceCount = 1;
            let j = i + 1;
            while (j < lines.length) {
                const openCount = (lines[j].match(/\{/g) || []).length;
                const closeCount = (lines[j].match(/\}/g) || []).length;
                braceCount += openCount - closeCount;
                if (braceCount === 0) {
                    // We found the closing brace for scope.launch {
                    // It's on line j.
                    // We need to append an extra closing brace `}` to close the function block.
                    lines[j] = lines[j] + '\n    }';
                    break;
                }
                j++;
            }
        }
    }
    
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
    console.log("Fixed successfully.");
}

fixFile();
