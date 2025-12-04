import { closeLoggerTransport } from './src/config';

afterAll(() => {
  closeLoggerTransport();
});
