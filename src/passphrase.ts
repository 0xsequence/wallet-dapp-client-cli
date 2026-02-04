import readline from 'node:readline/promises'

const promptHidden = async (prompt: string): Promise<string> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  })

  const raw = rl as unknown as {
    _writeToOutput?: (str: string) => void
    output: NodeJS.WriteStream
  }
  const originalWrite = raw._writeToOutput?.bind(raw)
  raw._writeToOutput = (str: string) => {
    if (str.includes('\n') || str.includes('\r')) {
      originalWrite?.(str)
      return
    }
    raw.output.write('*')
  }

  try {
    raw.output.write(prompt)
    const answer = await rl.question('')
    return answer.trim()
  } finally {
    rl.close()
  }
}

export const resolvePassphrase = async (options?: {
  passphrase?: string
  noPrompt?: boolean
}): Promise<string> => {
  if (options?.passphrase) return options.passphrase
  const envPassphrase = process.env.DAPP_CLIENT_CLI_PASSPHRASE
  if (envPassphrase && envPassphrase.length > 0) return envPassphrase

  if (options?.noPrompt) {
    throw new Error('Passphrase required. Provide --passphrase or set DAPP_CLIENT_CLI_PASSPHRASE.')
  }

  if (!process.stdin.isTTY) {
    throw new Error('Passphrase required but no TTY available. Provide --passphrase or set DAPP_CLIENT_CLI_PASSPHRASE.')
  }

  const answer = await promptHidden('Passphrase: ')
  if (!answer) {
    throw new Error('Passphrase required.')
  }
  return answer
}
