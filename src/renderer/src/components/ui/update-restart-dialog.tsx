import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'

// ── Types ──

interface UpdateDialogState {
  version: string
  releaseNotes?: string
}

// ── Internal state (module-level singleton) ──

let _setDialog: React.Dispatch<React.SetStateAction<UpdateDialogState | null>> | null = null

// ── Public imperative API ──

/**
 * Show update available dialog
 */
export function showUpdateDialog(version: string, releaseNotes?: string): void {
  if (!_setDialog) {
    console.warn('[showUpdateDialog] UpdateRestartDialogProvider is not mounted')
    return
  }
  _setDialog({ version, releaseNotes })
}

/**
 * Hide update dialog
 */
export function hideUpdateDialog(): void {
  if (!_setDialog) return
  _setDialog(null)
}

// ── Provider component (mount once at app root) ──

export function UpdateRestartDialogProvider(): React.JSX.Element {
  const { t } = useTranslation('common')
  const [dialog, setDialog] = React.useState<UpdateDialogState | null>(null)

  React.useEffect(() => {
    _setDialog = setDialog
    return () => {
      _setDialog = null
    }
  }, [])

  const handleRestartNow = React.useCallback(async () => {
    try {
      console.log('[Update] User chose to restart now')
      setDialog(null)
      await ipcClient.invoke('update:install')
    } catch (error) {
      console.error('[Update] Failed to restart:', error)
    }
  }, [])

  const handleRestartLater = React.useCallback(async () => {
    try {
      console.log('[Update] User chose to restart later')
      setDialog(null)
      await ipcClient.invoke('update:postpone')
    } catch (error) {
      console.error('[Update] Failed to postpone:', error)
    }
  }, [])

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) {
        // If user closes dialog without choosing, treat as "restart later"
        void handleRestartLater()
      }
    },
    [handleRestartLater]
  )

  if (!dialog) return <></>

  return (
    <AlertDialog open={!!dialog} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('app.update.restartTitle', 'Update Ready to Install')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              'app.update.restartDescription',
              'A new version ({{version}}) has been downloaded. Would you like to restart now to apply the update, or restart later?',
              { version: dialog.version }
            )}
          </AlertDialogDescription>
          {dialog.releaseNotes && (
            <div className="mt-4 max-h-[300px] overflow-y-auto rounded-md border bg-muted p-4">
              <h4 className="mb-2 text-sm font-semibold">
                {t('app.update.releaseNotes', 'Release Notes')}
              </h4>
              <div className="whitespace-pre-wrap text-sm text-muted-foreground">
                {dialog.releaseNotes}
              </div>
            </div>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm" onClick={handleRestartLater}>
            {t('app.update.restartLater', 'Restart Later')}
          </AlertDialogCancel>
          <AlertDialogAction size="sm" onClick={handleRestartNow}>
            {t('app.update.restartNow', 'Restart Now')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
