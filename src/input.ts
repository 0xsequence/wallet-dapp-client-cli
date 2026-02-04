import { promises as fs } from 'node:fs'
import path from 'node:path'

import { jsonRevivers } from '@0xsequence/dapp-client'

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = []
  return await new Promise((resolve, reject) => {
    process.stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    process.stdin.on('error', (err) => reject(err))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    const stat = await fs.stat(filePath)
    return stat.isFile()
  } catch {
    return false
  }
}

const resolveFilePath = (input: string): string => {
  if (path.isAbsolute(input)) return input
  return path.join(process.cwd(), input)
}

export const readJsonInput = async <T = unknown>(input: string, label: string): Promise<T> => {
  if (!input || input.trim().length === 0) {
    throw new Error(`Missing ${label} input.`)
  }

  if (input === '-') {
    const raw = await readStdin()
    return JSON.parse(raw, jsonRevivers) as T
  }

  let raw = input
  if (input.startsWith('@')) {
    const filePath = resolveFilePath(input.slice(1))
    raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw, jsonRevivers) as T
  }

  if (!input.trim().startsWith('{') && !input.trim().startsWith('[')) {
    const filePath = resolveFilePath(input)
    if (await fileExists(filePath)) {
      raw = await fs.readFile(filePath, 'utf8')
      return JSON.parse(raw, jsonRevivers) as T
    }
  }

  return JSON.parse(raw, jsonRevivers) as T
}
