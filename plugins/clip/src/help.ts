/** The plugin's help page, in Settings > Help under the plugin's name. */
export const HELP = `# Clip

Play part of a video from your library inside a note: the take you are writing about, the moment of a combo, on repeat.

## A clip

\`\`\`\`
\`\`\`clip
file: [[take3.mp4]]
start: 1:23.5
end: 1:41
\`\`\`
\`\`\`\`

| Key | Value | Default |
|---|---|---|
| \`file\` | the video: a link (\`[[take3.mp4]]\`), a path from the note's folder (\`clips/take3.mp4\`), or from the library root | |
| \`start\` | where the clip starts: seconds (\`83.5\`), \`m:ss\` (\`1:23.5\`) or \`h:mm:ss\` | the beginning |
| \`end\` | where it ends, written the same way | the end of the video |
| \`loop\` | \`true\` to start again at the end, \`false\` to stop there | \`true\` |
| \`muted\` | \`true\` to play without sound | \`false\` |

The clip shows its first frame, and below the video the file and the segment: "take3.mp4 · 1:23.5 → 1:41.0 (17.5 s)". Playback stays inside the segment: seeking before the start or past the end goes to that edge.

## Choosing the segment

Instead of typing times, play or scrub to the moment and click **Set Start** or **Set End**: the time is written into the block (Ctrl+Z undoes it). The video keeps its place, so you can set the end right after the start.

## Video formats

Ephemeris plays MP4 (H.264 video, AAC audio) and WebM. A \`.mov\` from a phone is usually H.264 and plays; ProRes \`.mov\`, \`.mkv\` and \`.avi\` do not, and the clip says so. Export or convert those to MP4 (in DaVinci Resolve: Deliver, H.264).
`;
