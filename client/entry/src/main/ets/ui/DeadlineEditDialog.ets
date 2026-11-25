import { AppTheme } from './AppTheme';
import { DeadlineEditor } from './DeadlineEditor';
import { DeadlineDialogState } from './DeadlineDialogState';

@CustomDialog
export struct DeadlineEditDialog {
  controller: CustomDialogController;
  @Link state: DeadlineDialogState;
  onApply: (date: string, time: string) => void;
  onCancel: () => void;
  build() {
    Scroll() {
      DeadlineEditor({ initialDate: this.state.date, initialTime: this.state.time, error: this.state.error,
        saving: this.state.saving, onApply: this.onApply, onCancel: this.onCancel })
    }.id('deadline-dialog').width('92%').constraintSize({ maxWidth: 480, maxHeight: '85%' })
      .backgroundColor(AppTheme.surface).borderRadius(24).clip(true)
  }
}
