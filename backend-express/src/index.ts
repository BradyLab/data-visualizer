import express, { Express, Request, Response, NextFunction } from 'express';

const app: Express = express();
const PORT = process.env.PORT || 3001;

// 1. Global Middleware
app.use(express.json()); // Parses incoming JSON payloads

// 2. Sample Health Check Route
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', timestamp: new Date() });
});

// 3. Centralized Error Handling Middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// 4. Server Initialization
app.listen(PORT, () => {
  console.log(`⚡️[server]: Server is running at http://localhost:${PORT}`);
});
