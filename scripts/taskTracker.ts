import fs from 'fs'
import path from 'path'

const TRACKER_FILE = path.resolve(process.cwd(), 'task-tracker.json')

type Status = 'pending' | 'running' | 'completed' | 'failed' | 'interrupted'

type TaskRecord = {
  id: string
  agent: string
  startTime: string | null
  endTime: string | null
  status: Status
  error?: string
}

class TaskTracker {
  private tasks: TaskRecord[] = []

  constructor() {
    this.load()
  }

  private load() {
    if (fs.existsSync(TRACKER_FILE)) {
      const data = fs.readFileSync(TRACKER_FILE, 'utf-8')
      this.tasks = JSON.parse(data)
    }
  }

  private save() {
    fs.writeFileSync(TRACKER_FILE, JSON.stringify(this.tasks, null, 2))
  }

  addTask(task: TaskRecord) {
    this.tasks.push(task)
    this.save()
  }

  updateTask(id: string, update: Partial<Omit<TaskRecord, 'id'>>) {
    const task = this.tasks.find(t => t.id === id)
    if (task) {
      Object.assign(task, update)
      this.save()
    }
  }

  getTasks() {
    return this.tasks
  }
}

const taskTracker = new TaskTracker()

export default taskTracker
