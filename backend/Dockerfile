# Use an official Node.js runtime as a parent image
FROM node:22-slim

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (or yarn.lock or pnpm-lock.yaml)
COPY package*.json ./

# Install project dependencies
# If you use yarn or pnpm, replace with 'yarn install --frozen-lockfile' or 'pnpm install --frozen-lockfile'
RUN npm install --omit=dev

# Copy the rest of the application code into the container
COPY . .

# Build the TypeScript code
RUN npm run build

# Make port 3000 available to the world outside this container
EXPOSE 3000

# Define environment variable if needed (though usually set at runtime)
# ENV NODE_ENV production

# Command to run the application
CMD ["npm", "start"]