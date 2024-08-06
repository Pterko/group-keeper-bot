# Use an official Node.js runtime as a parent image, based on Debian
FROM node:18-bullseye

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

# Define the command to run your app using CMD which defines your runtime
CMD ["node", "new-bot/build/src/main.js"]
