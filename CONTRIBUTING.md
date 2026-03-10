# Contributing to imrobot

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/leopechnicki/im_robot.git
cd im_robot
npm install
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm test` | Run tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run build` | Build the library |
| `npm run typecheck` | Type-check with TypeScript |
| `npm run lint` | Lint source files |
| `npm run format` | Format source files |

## Workflow

1. Fork the repo and create a feature branch from `main`
2. Make your changes
3. Run `npm test` and `npm run typecheck` to ensure everything passes
4. Run `npm run lint` to check for linting issues
5. Commit with a clear, descriptive message
6. Open a pull request against `main`

## Reporting Issues

Open an issue on GitHub with:
- A clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node version, browser)

## Code Style

- TypeScript strict mode is enabled
- Use Prettier for formatting (runs automatically via config)
- Follow existing patterns in the codebase

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
