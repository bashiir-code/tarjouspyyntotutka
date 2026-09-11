# Demovideo

A [Remotion](https://www.remotion.dev/) composition built on top of a real screen recording of the app.

1. **Recording** ([record.cjs](record.cjs)): Playwright drives the running app (`localhost:5173`), types two questions and scrolls through the answers. It writes `public/session.webm` and the event timestamps to [src/events.json](src/events.json).
2. **Editing** ([src/Demo.tsx](src/Demo.tsx)): intro card, the recording inside a browser frame, a caption for each step, and an outro with the eval numbers. The agent's working time is sped up (32× and 20×), and the counter shows the real elapsed seconds.

```bash
# app running: backend :8000 + frontend :5173
NODE_PATH=<playwright node_modules> node record.cjs
./node_modules/.bin/remotion ffmpeg -y -i public/session.webm -r 30 -c:v libx264 -pix_fmt yuv420p public/session.mp4
npx remotion studio                      # preview
npx remotion render src/index.ts Demo out/demo.mp4
npx remotion render src/index.ts Demo out/demo.gif --codec=gif --scale=0.5 --every-nth-frame=2
```

Recordings (`public/session.*`) and renders (`out/`) are not stored in git; the finished GIF is in [docs/demo.gif](../docs/demo.gif).
