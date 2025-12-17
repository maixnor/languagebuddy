import express from "express";
import { logger, config } from './core/config';
import { setupRoutes } from './routes';

export class Application {
  private app: express.Application;

  constructor() {
    this.app = express();
  }

  getApp(): express.Application {
    return this.app;
  }

  start(port: number): void {
    this.app.listen(port, () => {});
  }
}
