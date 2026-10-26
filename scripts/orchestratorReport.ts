import taskTracker from './taskTracker'

function generateReport(): string {
  const tasks = taskTracker.getTasks()
  let report = '# Agent Görevleri Raporu\n\n'

  tasks.forEach(task => {
    report += `- Görev ID: ${task.id}\n`
    report += `  Agent: ${task.agent}\n`
    report += `  Durum: ${task.status}\n`
    if (task.error) {
      report += `  Hata: ${task.error}\n`
    }
    report += '\n'
  })

  return report
}

export { generateReport }
