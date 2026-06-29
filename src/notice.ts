const NOTICE_DURATION_MS = 2200;

export function showNotice(message: string) {
	const container = getContainer();
	const notice = container.createDiv({ cls: 'graph-save-notice', text: message });

	window.setTimeout(() => {
		notice.detach();
		if (container.children.length === 0) {
			container.detach();
		}
	}, NOTICE_DURATION_MS);
}

function getContainer(): HTMLElement {
	return document.body.querySelector('.graph-save-notice-container')
		|| document.body.createDiv({ cls: 'graph-save-notice-container' });
}
