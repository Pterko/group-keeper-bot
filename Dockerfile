# Use an official Node runtime based on Debian as a parent image
FROM node:18-bullseye

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (or npm-shrinkwrap.json) files
COPY package*.json ./

# Install any needed packages
# Note: Debian-based images often have the necessary build tools pre-installed,
# but you can uncomment the next line if additional packages are needed
RUN apt-get update && apt-get install -y python3 build-essential pkg-config libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev

# Install Node.js dependencies
RUN npm install --only=production

# Bundle app source inside the docker image
COPY . .

# Your app binds to a port (e.g., 3000). EXPOSE it if needed.
EXPOSE 3000

# Define the command to run your app
CMD [ "npm", "start" ]
