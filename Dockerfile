# Use an official Node.js runtime as a parent image, based on Debian
FROM node:18-bullseye

# Install curl, FFmpeg, and other dependencies
RUN apt-get update && apt-get install -y curl ffmpeg && rm -rf /var/lib/apt/lists/*

# Download yt-dlp binary and make it executable
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

ENV YTDLP_PATH=/usr/local/bin/yt-dlp

# Set the working directory in the container to the parent of new-bot
WORKDIR /usr/src/app

# Copy the entire parent directory contents into the working directory
COPY . .

# Change directory to new-bot for npm operations
WORKDIR /usr/src/app

# Install any needed packages specified in package.json
# This is done after changing directory to new-bot
RUN cd new-bot && npm install

# Build the application
RUN cd new-bot && npm run build

# Your app binds to a port (e.g., 3000). EXPOSE it if needed.
EXPOSE 3000

WORKDIR /usr/src/app/new-bot

# Define the command to run your app using CMD which defines your runtime
CMD ["node", "-r", "dotenv/config", "-r", "newrelic", "build/src/main.js"]