import { execSync } from 'child_process'
import { pathToFileURL } from 'node:url'
import taskTracker from '../scripts/taskTracker'

function runAllTests() {
  // Add test start task record
  const taskId = 'test-run-001'
  taskTracker.addTask({
    id: taskId,
    agent: 'QA Agent',
    startTime: new Date().toISOString(),
    endTime: null,
    status: 'running'
  })

  try {
    // Run TypeScript check
    execSync('npx tsc --noEmit', { stdio: 'inherit' })

    // Run ESLint
    execSync('npx eslint . --max-warnings=0', { stdio: 'inherit' })

    // Run Vitest
    execSync('npx vitest run', { stdio: 'inherit' })

    // Run Production build
    execSync('npm run build', { stdio: 'inherit' })

    taskTracker.updateTask(taskId, {
      endTime: new Date().toISOString(),
      status: 'completed'
    })
  } catch (error) {
    taskTracker.updateTask(taskId, {
      endTime: new Date().toISOString(),
      status: 'failed',
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  runAllTests()
}

export { runAllTests }
