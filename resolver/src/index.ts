import express, { Request, Response } from "express";

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());

// Routes
app.get("/", (req: Request, res: Response) => {
  res.send("Hello from Express + TypeScript!");
});

app.get("/run-job", (req: Request, res: Response) => {
  // Simulate a cron-like task
  console.log("Running scheduled task...");
  res.send("Task executed.");
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
