/**
 * 企业技能文件加解密模块
 * 使用 AES-256-GCM 对称加密，密钥硬编码在源码中
 * 加密后文件内容: __COWORK_ENC_V1__<base64(IV+authTag+ciphertext)>
 */
import * as crypto from 'crypto'
import * as path from 'path'

// AES-256-GCM 密钥（32 字节 = 64 hex 字符）
const ENC_KEY = 'a7c3e9f1b2d4068e5f8a1c3d7b9e2f4a6d8c0b5e3f7a9d1c4b8e2f6a0d3c7b9e'

// 加密文件标记前缀
export const ENC_MARKER = '__COWORK_ENC_V1__'

// 需要加密的文件扩展名（文档类，不含可执行脚本）
export const ENCRYPT_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.cfg', '.ini'
])

/** 判断文件是否需要加密 */
export function shouldEncrypt(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  const baseName = path.basename(filePath).toLowerCase()
  if (baseName === 'skill.md' || baseName === 'skills.md') return true
  return ENCRYPT_EXTENSIONS.has(ext)
}

/** 判断内容是否已加密 */
export function isEncrypted(content: string): boolean {
  return content.startsWith(ENC_MARKER)
}

/** AES-256-GCM 加密，返回标记+base64 字符串 */
export function encryptContent(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENC_KEY, 'hex'), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  const combined = Buffer.concat([iv, authTag, encrypted])
  return ENC_MARKER + combined.toString('base64')
}

/** AES-256-GCM 解密，返回明文 */
export function decryptContent(encrypted: string): string {
  if (!encrypted.startsWith(ENC_MARKER)) {
    throw new Error('Content is not encrypted')
  }
  const combined = Buffer.from(encrypted.slice(ENC_MARKER.length), 'base64')
  const iv = combined.subarray(0, 12)
  const authTag = combined.subarray(12, 28)
  const ciphertext = combined.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(ENC_KEY, 'hex'), iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8')
}
