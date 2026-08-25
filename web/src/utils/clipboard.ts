function legacyCopyText(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  const selection = document.getSelection()
  const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  textarea.select()
  let copied = false
  try {
    copied = document.execCommand('copy')
  }
  catch {
    copied = false
  }
  document.body.removeChild(textarea)
  if (selection && previousRange) {
    selection.removeAllRanges()
    selection.addRange(previousRange)
  }
  return copied
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text)
    return false
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return true
    }
    catch {
      // 非安全上下文（http / 纯 IP）或浏览器策略拒绝时降级
    }
  }
  return legacyCopyText(text)
}
