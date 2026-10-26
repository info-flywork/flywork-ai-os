import fs from 'fs'
import path from 'path'

const TRACKER_FILE = path.resolve(process.cwd(), 'task-tracker.json')












class TaskTracker {
   tasks = []

  constructor() {
    this.load()
  }

   load() {
    if (fs.existsSync(TRACKER_FILE)) {
      const data = fs.readFileSync(TRACKER_FILE, 'utf-8')
      this.tasks = JSON.parse(data)
    }
  }

   save() {
    fs.writeFileSync(TRACKER_FILE, JSON.stringify(this.tasks, null, 2))
  }

  addTask(task) {
    this.tasks.push(task)
    this.save()
  }

  updateTask(id, update) {
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
