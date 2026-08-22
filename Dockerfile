# StreamVerse — portable container image.
#
# The app has ZERO npm dependencies, so there is no install step and no
# node_modules layer. That keeps the image tiny (~130 MB, mostly the Node
# base) and makes it deployable on any free container host: Koyeb,
# Back4app Containers, Google Cloud Run, Fly.io, a Raspberry Pi, whatever.
#
#   docker build -t streamverse .
#   docker run -p 3000:3000 -e TMDB_KEY=xxxx streamverse

FROM node:20-alpine

# Run as the unprivileged user that the base image already ships.
WORKDIR /app

# Copy only what the server actually needs at runtime. tools/ is the
# catalogue builder — useful to keep so you can refresh channels in place.
COPY package.json ./
COPY server.js movie-extract.js ./
COPY channels.json.gz ./
COPY index.html app.js style.css sw.js hls.min.js ./
COPY manifest.webmanifest robots.txt icon-192.png icon-512.png ./
COPY tools ./tools

ENV NODE_ENV=production
ENV PORT=3000
# Bind to every interface: container platforms route to the container IP,
# not to loopback, so 127.0.0.1 would be unreachable from outside.
ENV HOST=0.0.0.0

EXPOSE 3000

USER node

# Most free hosts read this to decide if the container is healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
