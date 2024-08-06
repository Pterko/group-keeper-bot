# Use an official Node.js runtime as a parent image, based on Debian
FROM node:18-bullseye

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (or npm-shrinkwrap.json) files
COPY package*.json ./new-bot/

# Install any needed packages specified in package.json
# This is done before copying the entire project to take advantage of cached Docker layers
RUN cd new-bot && npm install

# Copy the rest of the application source code
COPY ../ .

# Build the application
RUN cd new-bot && npm run build

# Your app binds to a port (e.g., 3000). EXPOSE it if needed.
EXPOSE 3000

# Define the command to run your app using CMD which defines your runtime
CMD [ "node", "new-bot/build/src/main.js" ]