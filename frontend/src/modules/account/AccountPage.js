import { accountService, ACCOUNT_CONNECTION_EVENT } from '../../services/AccountService.js';
import { learnerSync } from '../../services/LearnerSyncService.js';
import { attachAgentPanel } from './AgentPanel.js';
import { workspaceAccess, canUpdateStudentStatus, canApproveStudent, readLearningDashboard } from './LearningDashboard.js';
import { attachAiAdminSetup, canConfigureAi } from './AiAdminSetup.js';

const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = String(text);
    if (className) element.className = className;
    return element;
};
const date = value => value ? new Date(value).toLocaleString('vi-VN') : 'Chưa có';
const rowsOf = value => Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : [];
const nameOf = user => [user?.lastName ?? user?.last_name, user?.firstName ?? user?.first_name].filter(Boolean).join(' ') || 'Người học';

export function accountErrorMessage(error) {
    if (error?.code === 'BACKEND_NOT_CONFIGURED') return 'Tính năng tài khoản chưa được mở trên máy chủ này. Bạn vẫn có thể học và lưu trên thiết bị.';
    if (error?.status === 401) return 'Phiên đăng nhập hết hạn hoặc email/mật khẩu không đúng. Vui lòng đăng nhập lại.';
    if (error?.status === 403) return 'Tài khoản chưa có quyền thực hiện thao tác này. Nếu chưa xác minh email, hãy xác minh trước.';
    if (error?.status === 409) return 'Dữ liệu đã tồn tại hoặc đã thay đổi. Kiểm tra email đăng ký và thử lại.';
    if (error?.status === 429) return 'Bạn đã thử nhiều lần trong thời gian ngắn. Vui lòng chờ một phút rồi thử lại.';
    if (error?.status === 503) return 'Dịch vụ đang chưa sẵn sàng. Nếu đang yêu cầu email, máy chủ cần được cấu hình gửi thư.';
    if (error?.status === 400) return 'Thông tin chưa hợp lệ hoặc mã đã hết hạn/đã dùng. Kiểm tra các ô nhập; mật khẩu mới cần ít nhất 12 ký tự và tối đa 72 byte.';
    return error?.status >= 500 ? 'Máy chủ gặp lỗi. Dữ liệu trên thiết bị vẫn được giữ; vui lòng thử lại sau.' : error?.message || 'Không thể thực hiện yêu cầu. Vui lòng thử lại.';
}

export class AccountPage {
    constructor(root = document) {
        this.root = root;
        this.managementVersion = 0;
        this.enrollmentVersion = 0;
        this.managementMode = 'users';
        this.studentFilter = 'all';
        this.managementLoadedKey = '';
        this.agentCleanup = null;
        this.aiCleanup = null;
        this.workspaceView = 'learning';
        this.workspaceOwner = null;
        this.authOptions = { registrationEnabled: false, approvalRegistrationEnabled: false, emailDeliveryEnabled: false, managedAccountsEnabled: false };
        this.authOptionsLoaded = false;
        this.passwordTarget = null;
    }
    $(selector) { return this.root.querySelector(selector); }
    message(text, kind = 'success') {
        const output = this.$('#account-message');
        output.textContent = text;
        output.dataset.kind = kind;
        output.hidden = false;
        output.focus({ preventScroll: true });
    }
    mode(mode) {
        if (mode === 'register' && this.authOptionsLoaded && !this.authOptions.registrationEnabled && !this.authOptions.approvalRegistrationEnabled) mode = 'login';
        if (['verify', 'reset'].includes(mode) && !this.authOptions.emailDeliveryEnabled) mode = 'login';
        this.$('#account-auth').hidden = false;
        for (const panel of this.root.querySelectorAll('[data-auth-panel]')) panel.hidden = panel.dataset.authPanel !== mode;
        for (const button of this.root.querySelectorAll('[data-auth-mode]')) button.setAttribute('aria-pressed', String(button.dataset.authMode === mode));
    }
    bindForm(selector, handler) {
        const form = this.$(selector);
        const cancel = form.querySelector('[data-cancel-login]');
        let activeController;
        cancel?.addEventListener('click', () => activeController?.abort());
        form.addEventListener('submit', async event => {
            event.preventDefault();
            if (form.dataset.busy) return;
            const data = Object.fromEntries(new FormData(form));
            const controller = new AbortController();
            activeController = controller;
            const version = accountService.sessionVersion;
            const isCurrent = () => version === accountService.sessionVersion;
            for (const key of ['account-register', 'account-create-student'].includes(form.id) ? ['password'] : ['newPassword']) {
                if (data[key] && (new TextEncoder().encode(data[key]).length > 72 || data[key].includes('\0'))) {
                    this.message('Mật khẩu mới cần tối đa 72 byte và không chứa ký tự rỗng. Có thể dùng mật khẩu dài bằng chữ và số.', 'error');
                    return;
                }
            }
            form.dataset.busy = 'true';
            form.setAttribute('aria-busy', 'true');
            const buttons = [...form.querySelectorAll('button')];
            buttons.forEach(button => { button.disabled = button !== cancel; });
            if (cancel) cancel.hidden = false;
            const submit = form.querySelector('button[type="submit"]'), label = submit?.textContent;
            if (cancel && submit) submit.textContent = 'Đang đăng nhập…';
            try { await handler(data, { isCurrent, signal: controller.signal }); }
            catch (error) {
                if (error.code === 'SESSION_CHANGED') return;
                if (controller.signal.aborted) { this.message('Đã hủy chờ đăng nhập. Bạn có thể tiếp tục học hoặc thử lại.', 'info'); return; }
                if (!isCurrent() && !['account-login', 'account-register'].includes(form.id)) return;
                this.message(accountErrorMessage(error), 'error');
            }
            finally {
                for (const input of form.querySelectorAll('input[type="password"]')) input.value = '';
                delete form.dataset.busy;
                form.removeAttribute('aria-busy');
                if (cancel) cancel.hidden = true;
                if (submit && label) submit.textContent = label;
                activeController = null;
                buttons.forEach(button => { button.disabled = !accountService.configured; });
            }
        });
    }
    async init() {
        globalThis.window?.addEventListener(ACCOUNT_CONNECTION_EVENT, () => this.renderConnection());
        this.renderConnection();
        this.authOptionsPromise = this.loadAuthOptions();
        for (const button of this.root.querySelectorAll('[data-auth-mode]')) button.addEventListener('click', () => this.mode(button.dataset.authMode));
        this.bindForm('#account-login', async (data, { signal }) => {
            const user = await accountService.signIn(data, { signal });
            if (accountService.user !== user) return;
            this.$('#account-message').hidden = true;
        });
        this.bindForm('#account-register', async (data, { isCurrent, signal }) => {
            await this.authOptionsPromise;
            if (!isCurrent() || signal.aborted) return;
            if (this.authOptions.approvalRegistrationEnabled) {
                await accountService.request('/v1/auth/student-requests', { method: 'POST', body: data, auth: false, signal });
                if (!isCurrent()) return;
                this.$('#account-register').reset();
                this.$('#login-email').value = data.email;
                this.mode('login');
                this.message('Đã gửi đăng ký. Quản trị viên sẽ duyệt tài khoản; sau đó bạn đăng nhập bằng email và mật khẩu vừa chọn.');
                return;
            }
            if (!this.authOptions.registrationEnabled) throw new Error('Đăng ký đang tạm đóng. Hãy liên hệ người phụ trách.');
            const user = await accountService.register(data, { signal });
            if (accountService.user !== user) return;
            this.$('#verify-email').value = data.email;
            this.mode('verify');
            this.message('Đã tạo tài khoản. Gửi mã xác minh đến email để bật lưu học tập.');
        });
        this.bindForm('#account-resend', async (data, { isCurrent }) => {
            await accountService.request('/v1/auth/resend-verification', { method: 'POST', body: data, auth: false });
            if (!isCurrent()) return;
            this.message('Nếu tài khoản đủ điều kiện, mã xác minh sẽ được gửi đến email. Kiểm tra cả thư mục thư rác.');
        });
        this.bindForm('#account-verify', async (data, { isCurrent }) => {
            await accountService.request('/v1/auth/verify-email', { method: 'POST', body: data, auth: false });
            if (!isCurrent()) return;
            this.$('#verify-token').value = '';
            if (accountService.user) await accountService.reloadProfile();
            else this.mode('login');
            if (!isCurrent()) return;
            this.message('Email đã được xác minh. Bạn có thể đăng nhập và đồng bộ học tập.');
        });
        this.bindForm('#account-forgot', async (data, { isCurrent }) => {
            await accountService.request('/v1/auth/forgot-password', { method: 'POST', body: data, auth: false });
            if (!isCurrent()) return;
            this.message('Nếu tài khoản đủ điều kiện, mã đặt lại mật khẩu sẽ được gửi đến email. Mã có hiệu lực 30 phút.');
        });
        this.bindForm('#account-reset', async (data, { isCurrent }) => {
            await accountService.request('/v1/auth/reset-password', { method: 'POST', body: data, auth: false });
            if (!isCurrent()) return;
            // Reset revokes every server session; clear this browser's previous identity too.
            if (accountService.user) {
                const logout = accountService.signOut(), logoutVersion = accountService.sessionVersion;
                await logout.catch(() => {});
                if (logoutVersion !== accountService.sessionVersion) return;
            }
            this.$('#reset-token').value = '';
            this.mode('login');
            this.message('Đã đổi mật khẩu. Đăng nhập lại bằng mật khẩu mới.');
        });
        this.bindForm('#account-profile', async (data, { isCurrent }) => {
            await accountService.request('/v1/auth/me', { method: 'PATCH', body: data });
            if (!isCurrent()) return;
            await accountService.reloadProfile();
            if (!isCurrent()) return;
            this.message('Đã lưu hồ sơ.');
        });
        this.bindForm('#account-change-password', async (data, { isCurrent }) => {
            await accountService.request('/v1/auth/change-password', { method: 'POST', body: data });
            if (!isCurrent()) return;
            const logout = accountService.signOut(), logoutVersion = accountService.sessionVersion;
            await logout.catch(() => {});
            if (logoutVersion !== accountService.sessionVersion) return;
            this.mode('login');
            this.message('Đã đổi mật khẩu và thu hồi các phiên đăng nhập. Vui lòng đăng nhập lại.');
        });
        this.bindForm('#account-student-password', async (data, { isCurrent }) => {
            const target = this.passwordTarget, actor = accountService.user;
            if (!target || target.ownerId !== actor?.id || !target.isActive || !canUpdateStudentStatus(actor, target, { offline: accountService.sessionOffline }))
                throw new Error('Không còn quyền đổi mật khẩu cho tài khoản này. Hãy tải lại danh sách học viên.');
            await accountService.request(`/v1/users/${encodeURIComponent(target.id)}/student-password`, { method: 'POST', body: { newPassword: data.newPassword } });
            if (!isCurrent()) return;
            this.$('#account-student-password-dialog').close();
            this.message('Đã đặt mật khẩu mới và thu hồi các phiên của học sinh. Cung cấp mật khẩu cho đúng học sinh qua kênh riêng.');
        });
        this.$('#account-student-password-cancel').addEventListener('click', () => this.$('#account-student-password-dialog').close());
        this.$('#account-student-password-dialog').addEventListener('close', () => {
            this.passwordTarget = null;
            this.$('#student-new-password').value = '';
            this.$('#student-password-confirm').checked = false;
        });
        for (const [id, all] of [['#account-logout', false], ['#account-logout-all', true]]) this.$(id).addEventListener('click', async () => {
            if (all && !confirm('Đăng xuất tài khoản trên tất cả thiết bị?')) return;
            const logout = accountService.signOut({ all }), version = accountService.sessionVersion;
            try { await logout; if (version === accountService.sessionVersion) this.message(all ? 'Đã đăng xuất mọi thiết bị.' : 'Đã đăng xuất.'); }
            catch { if (version === accountService.sessionVersion) this.message('Đã đăng xuất trên trình duyệt này. Chưa liên hệ được máy chủ để thu hồi phiên từ xa.', 'error'); }
        });
        this.$('#account-show-verify').addEventListener('click', () => { this.mode('verify'); this.$('#verify-email').focus(); });
        this.$('#account-activity-load').addEventListener('click', () => this.loadActivity());
        const events = [['#account-sync-now', 'strobot:sync-now'], ['#account-import-local', 'strobot:sync-import-local'], ['#account-sync-export', 'strobot:sync-export'], ['#account-sync-use-server', 'strobot:sync-use-server'], ['#account-sync-keep-local', 'strobot:sync-keep-local']];
        for (const [id, type] of events) this.$(id).addEventListener('click', () => {
            if (type === 'strobot:sync-import-local' && !confirm('Nhập dữ liệu học khi chưa đăng nhập vào tài khoản hiện tại? Chỉ tiếp tục nếu đó là dữ liệu của bạn.')) return;
            if (type === 'strobot:sync-use-server' && !confirm('Dùng dữ liệu trên máy chủ và thay thế bản đang lưu trên thiết bị? Hãy tải bản sao trên thiết bị trước khi tiếp tục.')) return;
            if (type === 'strobot:sync-keep-local' && !confirm('Dùng bản trên thiết bị để thay thế dữ liệu mới hơn trên máy chủ? Chỉ tiếp tục nếu bạn đã kiểm tra và muốn giữ bản này.')) return;
            document.dispatchEvent(new CustomEvent(type));
        });
        document.addEventListener('strobot:sync-status', event => { this.renderSync(event.detail || {}); this.renderLearningDashboard(); });
        for (const type of ['strobot:learner-scope-changed', 'strobot:learner-data-updated']) document.addEventListener(type, () => this.renderLearningDashboard());
        for (const button of this.root.querySelectorAll('[data-workspace-view]')) button.addEventListener('click', () => this.selectWorkspace(button.dataset.workspaceView));
        accountService.subscribe(user => this.renderUser(user));
        for (const selector of ['#account-agent-details', '#account-ai-settings-details'])
            this.$(selector).addEventListener('toggle', () => this.renderOptionalPanels());
        this.$('#account-enrollments').addEventListener('toggle', () => { if (this.$('#account-enrollments').open && accountService.user) this.renderEnrollments(accountService.user); });
        await learnerSync.ready();
        this.renderUser(accountService.user);
        if (accountService.sessionError && accountService.configured) this.message(accountErrorMessage(accountService.sessionError), 'error');
    }
    async loadAuthOptions() {
        if (!accountService.configured) return;
        try {
            const options = await accountService.request('/v1/auth/options', { auth: false, timeoutMs: 5000 });
            if (['registrationEnabled', 'emailDeliveryEnabled', 'managedAccountsEnabled'].every(key => typeof options[key] === 'boolean')) this.authOptions = options;
        } catch (error) {
            // Older compatible APIs have no options route and retain email registration.
            if (error.status !== 404) this.authOptions = { registrationEnabled: false, emailDeliveryEnabled: false, managedAccountsEnabled: false };
        }
        this.authOptionsLoaded = true;
        this.applyAuthOptions();
    }
    applyAuthOptions() {
        for (const button of this.root.querySelectorAll('[data-auth-mode]')) {
            button.hidden = button.dataset.authMode === 'register' ? !this.authOptions.registrationEnabled && !this.authOptions.approvalRegistrationEnabled
                : ['verify', 'reset'].includes(button.dataset.authMode) ? !this.authOptions.emailDeliveryEnabled : false;
        }
        const note = this.$('#account-registration-options');
        note.hidden = false;
        note.textContent = this.authOptions.approvalRegistrationEnabled
            ? 'Học sinh đăng ký tại đây. Sau khi quản trị viên duyệt, tài khoản sẽ dùng chung cho tiến độ, bài thực hành và trợ lý AI.'
            : this.authOptions.registrationEnabled ? 'Tạo tài khoản để lưu tiến độ và tiếp tục học trên thiết bị khác.'
                : 'Đăng ký đang tạm đóng. Liên hệ người phụ trách để nhận tài khoản.';
        this.$('#account-register-help').textContent = this.authOptions.approvalRegistrationEnabled
            ? 'Điền thông tin để gửi yêu cầu tài khoản học sinh. Quản trị viên duyệt trước khi bạn đăng nhập.'
            : 'Mật khẩu từ 12 ký tự. Xác minh email sau khi tạo để bật lưu tiến độ.';
        this.$('#account-register-submit').textContent = this.authOptions.approvalRegistrationEnabled ? 'Gửi yêu cầu đăng ký' : 'Tạo tài khoản';
        this.$('#account-show-verify').hidden = !accountService.user || accountService.user.isEmailVerified || !this.authOptions.emailDeliveryEnabled;
        if (!this.$('#account-auth').hidden) {
            const active = [...this.root.querySelectorAll('[data-auth-mode]')].find(button => button.getAttribute('aria-pressed') === 'true');
            if (active?.hidden) this.mode('login');
        }
        if (accountService.user && this.managementMode === 'users' && !this.$('#account-management').hidden) this.loadManagement('users');
    }
    renderSync(detail) {
        this.$('#account-sync-status').textContent = detail.message || 'Chưa có trạng thái đồng bộ.';
        this.$('#account-import-local').hidden = !detail.canImport;
        this.$('#account-sync-export').hidden = !detail.conflict;
        this.$('#account-sync-use-server').hidden = !detail.conflict;
        this.$('#account-sync-keep-local').hidden = !detail.conflict;
        if (detail.conflict) { this.$('#account-sync-tools').open = true; this.selectWorkspace('settings'); }
    }
    renderConnection() {
        const output = this.$('#account-server-status');
        if (!output) return;
        clearTimeout(this.connectionTimer);
        const connecting = accountService.connectionStatus === 'connecting';
        const offline = accountService.user && accountService.sessionOffline;
        const failed = accountService.connectionStatus === 'error';
        output.hidden = Boolean(accountService.configured && !connecting && !offline && !failed);
        const elapsed = Math.floor((accountService.connectionElapsedMs || 0) / 1000);
        const text = !accountService.configured
            ? 'Tài khoản chưa được mở trên máy chủ này. Bạn vẫn có thể học và lưu trên thiết bị.'
            : connecting ? `Đang kết nối tài khoản${elapsed > 2 ? ` · ${elapsed} giây` : ''}… Máy chủ miễn phí có thể cần thức dậy; bạn vẫn có thể xem khóa học.`
                : offline ? 'Bạn đang học bằng bản lưu trên thiết bị. Tiến độ sẽ đồng bộ khi kết nối trở lại.'
                    : 'Chưa kết nối được tài khoản. Tiến độ trên thiết bị vẫn được giữ.';
        output.replaceChildren(node('span', text));
        if (failed && accountService.configured) {
            const retry = node('button', 'Kết nối lại', 'btn btn--ghost btn--sm'); retry.type = 'button';
            retry.addEventListener('click', () => { this.authOptionsPromise = this.loadAuthOptions(); }); output.append(retry);
        }
        if (connecting) this.connectionTimer = setTimeout(() => this.renderConnection(), 1000);
    }
    renderUser(user) {
        this.managementVersion++;
        this.managementLoadedKey = '';
        this.enrollmentVersion++;
        this.$('#account-signed-in').hidden = !user;
        this.$('#account-page-title').textContent = user ? `Chào ${user.firstName || nameOf(user)}!` : 'Học tập, cùng một tài khoản';
        this.$('#account-page-description').textContent = user ? 'Tiến độ và bài làm của bạn được lưu theo tài khoản.' : 'Đăng nhập để tiếp tục bài học, lưu tiến độ và nhận hỗ trợ từ trợ lý AI.';
        this.$('#account-auth').hidden = !!user;
        this.$('.account-intro').hidden = !!user;
        this.$('#account-activity-content').replaceChildren();
        if (this.passwordTarget && (this.passwordTarget.ownerId !== user?.id || !canUpdateStudentStatus(user, this.passwordTarget, { offline: accountService.sessionOffline }))) this.$('#account-student-password-dialog').close();
        this.renderConnection();
        for (const button of this.root.querySelectorAll('#account-auth button, #account-auth input')) button.disabled = !accountService.configured;
        if (!user) {
            this.workspaceOwner = null;
            this.managementLoadedKey = '';
            this.renderOptionalPanels();
            this.$('#account-role-label').textContent = '';
            this.$('#account-student-content').replaceChildren();
            this.$('#account-management-content').replaceChildren();
            this.mode('login'); return;
        }
        this.$('#account-identity').textContent = `${nameOf(user)} · ${user.email}`;
        this.$('#account-verification').textContent = user.isEmailVerified ? 'Tài khoản đã được xác nhận; có thể đồng bộ học tập.' : 'Tài khoản chưa được xác nhận. Xác minh email hoặc liên hệ quản trị viên để bật lưu tiến độ lên máy chủ.';
        this.$('#account-show-verify').hidden = !!user.isEmailVerified || !this.authOptions.emailDeliveryEnabled;
        this.$('#verify-email').value = user.email;
        this.$('#profile-first').value = user.firstName || '';
        this.$('#profile-last').value = user.lastName || '';
        this.$('#account-sync-now').disabled = !user.isEmailVerified;
        this.renderSync(learnerSync.status);
        if (this.$('#account-enrollments').open) this.renderEnrollments(user);
        const access = workspaceAccess(user, { offline: accountService.sessionOffline });
        this.$('#account-role-label').textContent = access.label;
        this.$('#account-workspace-switch').hidden = false;
        this.$('[data-workspace-view="management"]').hidden = !access.management;
        this.$('[data-workspace-view="settings"]').textContent = access.management ? 'Cài đặt' : 'Tài khoản';
        if (this.workspaceOwner !== user.id) { this.workspaceView = access.management ? 'management' : 'learning'; this.managementMode = access.manager ? 'users' : 'courses'; this.managementLoadedKey = ''; }
        this.workspaceOwner = user.id;
        this.selectWorkspace(this.workspaceView);
        this.renderLearningDashboard();
    }
    selectWorkspace(view) {
        const user = accountService.user;
        const access = workspaceAccess(user, { offline: accountService.sessionOffline });
        this.workspaceView = view === 'management' && access.management ? 'management' : view === 'settings' ? 'settings' : 'learning';
        this.$('#account-workspace-title').textContent = this.workspaceView === 'management'
            ? access.manager ? 'Học viên của bạn' : 'Lớp học phụ trách'
            : this.workspaceView === 'settings' ? 'Tài khoản & cài đặt' : `Chào ${user?.firstName || 'bạn'}!`;
        this.$('#account-workspace-description').textContent = this.workspaceView === 'management'
            ? 'Duyệt đăng ký, cấp tài khoản và theo dõi tiến độ từ các thiết bị.'
            : this.workspaceView === 'settings' ? 'Hồ sơ, bảo mật và các tùy chọn bổ sung.' : 'Mở bài gần nhất, xem tiến độ và tiếp tục học.';
        for (const button of this.root.querySelectorAll('[data-workspace-view]')) button.setAttribute('aria-pressed', String(button.dataset.workspaceView === this.workspaceView));
        for (const section of this.root.querySelectorAll('[data-workspace-section]')) section.hidden = section.dataset.workspaceSection !== this.workspaceView;
        this.$('#account-management').hidden = !user || !access.management || this.workspaceView !== 'management';
        if (user && access.management && this.workspaceView === 'management') this.renderManagement(user);
        this.renderOptionalPanels();
    }
    renderOptionalPanels() {
        const user = accountService.user;
        const showAgent = Boolean(user && this.workspaceView === 'learning' && this.$('#account-agent-details').open);
        if (showAgent && !this.agentCleanup) this.agentCleanup = attachAgentPanel(this.$('#account-agent'));
        else if (!showAgent && this.agentCleanup) { this.agentCleanup(); this.agentCleanup = null; }
        const allowedAi = canConfigureAi(user, accountService.sessionOffline);
        const details = this.$('#account-ai-settings-details');
        details.hidden = !allowedAi;
        if (!allowedAi) details.open = false;
        const showAi = allowedAi && this.workspaceView === 'settings' && details.open;
        this.$('#account-ai-setup').hidden = !showAi;
        if (showAi && !this.aiCleanup) this.aiCleanup = attachAiAdminSetup(this.$('#account-ai-setup'));
        else if (!showAi && this.aiCleanup) { this.aiCleanup(); this.aiCleanup = null; }
    }
    renderLearningDashboard() {
        const output = this.$('#account-student-content'), user = accountService.user;
        if (!output || !user) return;
        if (learnerSync.ownerId !== user.id) { output.replaceChildren(node('p', 'Đang mở dữ liệu riêng của tài khoản…')); return; }
        try {
            const dashboard = readLearningDashboard(learnerSync.scopedStorage(user.id));
            output.replaceChildren();
            const course = dashboard.resumeCourse || dashboard.courses[0];
            const resume = node('div', undefined, 'account-resume'), welcome = node('div');
            welcome.append(node('span', dashboard.resumeCourse ? 'BÀI HỌC GẦN NHẤT' : 'BẮT ĐẦU HÀNH TRÌNH', 'account-role-note'), node('h3', course.name), node('p', course.nextLessonTitle));
            const actions = node('div', undefined, 'account-actions');
            const continueLink = node('a', dashboard.resumeCourse ? 'Tiếp tục học →' : 'Bắt đầu học →', 'btn btn--primary'); continueLink.id = 'account-resume-study';
            continueLink.href = `course.learning.html?course=${encodeURIComponent(course.id)}&lesson=${encodeURIComponent(course.nextLessonId)}`;
            const agent = node('button', 'Hỏi trợ lý AI', 'btn btn--ghost'); agent.type = 'button'; agent.id = 'account-open-agent';
            agent.addEventListener('click', () => { const details = this.$('#account-agent-details'); details.open = true; details.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
            actions.append(continueLink, agent); resume.append(welcome, actions); output.append(resume);
            const metrics = node('dl', undefined, 'account-metrics');
            for (const [label, value] of [['Bài đã hoàn thành', `${dashboard.completed}/${dashboard.total}`], ['Nhật ký bài học', dashboard.journals], ['Lượt tự kiểm tra', dashboard.quizAttempts], ['Lượt ôn luyện', dashboard.practiceAttempts]]) {
                const item = node('div'); item.append(node('dt', label), node('dd', value)); metrics.append(item);
            }
            output.append(metrics);
            if (dashboard.recentQuiz) output.append(node('p', `Tự kiểm tra gần nhất: ${dashboard.recentQuiz.courseName} · ${dashboard.recentQuiz.correct}/${dashboard.recentQuiz.total} câu (${dashboard.recentQuiz.percentage}%)`, 'account-role-note'));
            const grid = node('div', undefined, 'account-learning-courses');
            for (const course of dashboard.courses) {
                const item = node('article', undefined, 'account-learning-course'); item.dataset.courseId = course.id;
                item.append(node('h3', course.name), node('p', `${course.completed}/${course.total} bài tự hoàn thành · ${course.journals} nhật ký`));
                const meter = node('progress'); meter.max = course.total; meter.value = course.completed;
                meter.setAttribute('aria-label', `${course.name}: ${course.completed} trên ${course.total} bài tự hoàn thành`);
                const link = node('a', course.saved ? `Tiếp tục: ${course.nextLessonTitle} →` : 'Mở bài đầu tiên →', 'account-resume-link');
                link.href = `course.learning.html?course=${encodeURIComponent(course.id)}&lesson=${encodeURIComponent(course.nextLessonId)}`;
                item.append(meter, link); grid.append(item);
            }
            output.append(grid);
        } catch (error) { output.replaceChildren(node('p', error.message || 'Chưa đọc được dữ liệu học tập của tài khoản.')); }
    }
    async renderEnrollments(user) {
        const version = ++this.enrollmentVersion, output = this.$('#account-enrollments-content');
        output.replaceChildren(node('p', user.isEmailVerified ? 'Đang tải khóa học…' : 'Xác minh email trước khi tham gia khóa học.'));
        if (!user.isEmailVerified) return;
        if (accountService.sessionOffline) { output.replaceChildren(node('p', 'Kết nối lại máy chủ để xem và thay đổi khóa đã tham gia.')); return; }
        try {
            const [published, enrolled] = await Promise.all([
                accountService.request('/v1/courses?limit=100', { auth: false }),
                accountService.request('/v1/enrollments?limit=100'),
            ]);
            if (version !== this.enrollmentVersion || accountService.user?.id !== user.id) return;
            const courses = rowsOf(published), own = new Map(rowsOf(enrolled).map(item => [item.course.id, item]));
            output.replaceChildren();
            if (!courses.length) { output.append(node('p', 'Chưa có khóa được mở tham gia. Các bài tự học vẫn hoạt động bình thường.')); return; }
            const list = node('ul', undefined, 'account-course-list');
            for (const course of courses) {
                const item = node('li'), active = own.get(course.id);
                item.append(node('h3', course.title));
                if (active) item.append(node('p', `Đã tham gia từ ${date(active.enrolledAt)}. Giảng viên phụ trách có thể xem tóm tắt tự học.`));
                const button = node('button', active ? 'Rời khóa' : 'Tham gia khóa', active ? 'btn btn--ghost' : 'btn btn--primary'); button.type = 'button';
                button.addEventListener('click', async () => {
                    if (active && !confirm('Rời khóa này và dừng chia sẻ tóm tắt với giảng viên phụ trách? Tiến độ và nhật ký của bạn vẫn được giữ.')) return;
                    button.disabled = true;
                    try {
                        const result = await accountService.request(`/v1/enrollments/${encodeURIComponent(course.id)}`, { method: active ? 'DELETE' : 'POST' });
                        if (version !== this.enrollmentVersion) return;
                        if (result.status === 'pending') {
                            this.message('Đã gửi yêu cầu tham gia; đang chờ người phụ trách duyệt.'); button.textContent = 'Đang chờ duyệt';
                        } else {
                            this.message(active ? 'Đã rời khóa. Tiến độ tự học vẫn được giữ.' : 'Đã tham gia khóa học.');
                            this.renderEnrollments(accountService.user);
                        }
                    } catch (error) { this.message(accountErrorMessage(error), 'error'); button.disabled = false; }
                });
                item.append(button); list.append(item);
            }
            output.append(list);
            if (courses.length === 100 || own.size === 100) output.append(node('p', 'Đang hiển thị tối đa 100 khóa học.'));
        } catch (error) {
            if (version !== this.enrollmentVersion) return;
            output.replaceChildren(node('p', accountErrorMessage(error)));
            const retry = node('button', 'Tải lại khóa học', 'btn btn--ghost'); retry.type = 'button'; retry.addEventListener('click', () => this.renderEnrollments(accountService.user)); output.append(retry);
        }
    }
    async loadActivity() {
        const userId = accountService.user?.id, output = this.$('#account-activity-content'), button = this.$('#account-activity-load');
        if (!userId) return;
        button.disabled = true; output.replaceChildren(node('p', 'Đang tải hoạt động…'));
        try {
            const data = await accountService.request('/v1/learner-state/activity?limit=20');
            if (accountService.user?.id !== userId) return;
            const labels = { 'learner.lesson_opened': 'Mở bài học', 'learner.lesson_completed': 'Đánh dấu hoàn thành bài', 'learner.lab_opened': 'Mở phòng lab', 'learner.quiz_completed': 'Hoàn thành tự kiểm tra', 'learner.portfolio_saved': 'Lưu nhật ký thực hành', 'learner.assessment_completed': 'Hoàn thành bài đánh giá', 'learner.state_synced': 'Đồng bộ dữ liệu học tập' };
            const rows = rowsOf(data); output.replaceChildren();
            if (!rows.length) output.append(node('p', 'Chưa có hoạt động được ghi nhận trên máy chủ.'));
            else this.table(output, ['Thời gian', 'Thao tác', 'Khóa / bài'], rows.map(row => [date(row.recordedAt), labels[row.action] || 'Hoạt động học tập', [row.details?.courseId, row.details?.lessonId].filter(Boolean).join(' / ') || '—']));
        } catch (error) { if (accountService.user?.id === userId) output.replaceChildren(node('p', accountErrorMessage(error))); }
        finally { button.disabled = false; }
    }
    renderManagement(user) {
        const roles = user.roles || [], permissions = user.permissions || [];
        const manager = roles.some(role => role.group === 'MANAGER' && role.scopeType === 'SYSTEM');
        const staff = roles.some(role => ['TEACHER', 'MANAGER'].includes(role.group));
        const available = [];
        if (manager && permissions.includes('users:read')) available.push(['users', 'Học viên']);
        if (staff) available.push(['courses', 'Khóa học phụ trách']);
        if (manager && permissions.includes('dashboard:read')) available.push(['overview', 'Tổng quan']);
        if (manager && permissions.includes('audit:read')) available.push(['audit', 'Lịch sử thao tác']);
        if (manager && permissions.includes('analytics:read')) available.push(['learning', 'Báo cáo học tập']);
        const section = this.$('#account-management'), tabs = this.$('#account-management-tabs');
        section.hidden = accountService.sessionOffline || !user.isEmailVerified || !available.length;
        tabs.replaceChildren();
        if (section.hidden) return;
        const extra = node('details', undefined, 'account-management-extra'); extra.append(node('summary', 'Báo cáo khác'));
        for (const [mode, label] of available) {
            const button = node('button', label, 'btn btn--ghost'); button.type = 'button'; button.dataset.managementMode = mode;
            button.addEventListener('click', () => this.loadManagement(mode));
            (['audit', 'learning'].includes(mode) ? extra : tabs).append(button);
        }
        if (extra.children.length > 1) tabs.append(extra);
        if (!available.some(([mode]) => mode === this.managementMode)) this.managementMode = available[0][0];
        const key = `${user.id}:${accountService.sessionVersion}:${this.managementMode}`;
        if (key !== this.managementLoadedKey) this.loadManagement(this.managementMode);
        else for (const button of this.root.querySelectorAll('[data-management-mode]')) button.setAttribute('aria-pressed', String(button.dataset.managementMode === this.managementMode));
    }
    async loadManagement(mode, { page = 1, search = '', status = this.studentFilter } = {}) {
        const actor = accountService.user;
        if (!actor || !workspaceAccess(actor, { offline: accountService.sessionOffline }).management) return;
        this.managementMode = mode;
        this.studentFilter = ['all', 'pending', 'active', 'locked'].includes(status) ? status : 'all';
        this.managementLoadedKey = `${actor.id}:${accountService.sessionVersion}:${mode}`;
        const version = ++this.managementVersion, output = this.$('#account-management-content');
        output.replaceChildren(node('p', 'Đang tải dữ liệu…'));
        for (const button of this.root.querySelectorAll('[data-management-mode]')) button.setAttribute('aria-pressed', String(button.dataset.managementMode === mode));
        try {
            const students = mode === 'users' && actor.permissions?.includes('analytics:read');
            const limit = students ? 20 : 10;
            const query = `?limit=${limit}&page=${page}${search ? `&search=${encodeURIComponent(search)}` : ''}`;
            const path = { overview: '/v1/admin/dashboard', users: students ? '/v1/users/student-overview' + query + `&status=${this.studentFilter}` : '/v1/users' + query,
                courses: '/v1/teacher/courses' + query, audit: '/v1/admin/audit' + query, learning: '/v1/learner-state/management' + query }[mode];
            if (!path) return;
            const data = await accountService.request(path);
            if (version !== this.managementVersion || accountService.user?.id !== actor.id) return;
            output.replaceChildren();
            if (mode === 'overview') { this.overview(output, data); return; }
            if (mode === 'users' || mode === 'courses') this.search(output, mode, search);
            if (mode === 'users') {
                const toolbar = node('div', undefined, 'account-student-toolbar');
                if (students) {
                    const filters = node('div', undefined, 'account-filter-tabs'); filters.setAttribute('aria-label', 'Lọc học viên');
                    for (const [value, label] of [['all', 'Tất cả'], ['pending', 'Chờ duyệt'], ['active', 'Đang học'], ['locked', 'Đã khóa']]) {
                        const button = node('button', label, 'btn btn--ghost btn--sm'); button.type = 'button'; button.dataset.studentFilter = value;
                        button.setAttribute('aria-pressed', String(value === this.studentFilter));
                        button.addEventListener('click', () => this.loadManagement('users', { search, status: value })); filters.append(button);
                    }
                    toolbar.append(filters);
                }
                const refresh = node('button', 'Làm mới danh sách', 'btn btn--ghost btn--sm'); refresh.type = 'button'; refresh.dataset.studentRefresh = '';
                refresh.addEventListener('click', () => this.loadManagement('users', { page, search })); toolbar.append(refresh); output.append(toolbar);
                this.createStudentForm(output, version);
                output.append(node('p', 'Tiến độ cập nhật từ tài khoản trên các thiết bị. Nhật ký và mã riêng của học sinh không xuất hiện trong danh sách này.', 'account-role-note'));
            }
            const rows = rowsOf(data);
            if (!rows.length) output.append(node('p', mode === 'users' && this.studentFilter === 'pending' ? 'Không có đăng ký đang chờ duyệt.' : 'Chưa có dữ liệu phù hợp.', 'account-empty'));
            else if (mode === 'users') this.users(output, rows, version, { page, search });
            else if (mode === 'audit') this.table(output, ['Thời gian', 'Thao tác', 'Tài nguyên', 'Người thực hiện'], rows.map(row => [date(row.created_at), row.action, row.resource || '—', row.user_id || 'Hệ thống']));
            else if (mode === 'learning') this.learningSummaries(output, rows);
            else this.courses(output, rows, version);
            const metadata = data?.meta || data?.pagination || {};
            this.pagination(output, mode, page, search, Number.isFinite(metadata.totalPages) ? page < metadata.totalPages : rows.length === limit);
        } catch (error) {
            if (version !== this.managementVersion || accountService.user?.id !== actor.id) return;
            output.replaceChildren(node('p', accountErrorMessage(error)));
            const retry = node('button', 'Thử lại', 'btn btn--ghost'); retry.type = 'button';
            retry.addEventListener('click', () => this.loadManagement(mode, { page, search })); output.append(retry);
        }
    }
    overview(output, data) {
        const metrics = [['users', 'Tài khoản'], ['activeStudents', 'Học viên đang hoạt động'], ['teachers', 'Giáo viên'], ['publishedCourses', 'Khóa học đã xuất bản'], ['learningActivityLast7Days', 'Bài có hoạt động trong 7 ngày'], ['pendingApprovals', 'Yêu cầu chờ duyệt']];
        const list = node('dl', undefined, 'account-metrics');
        for (const [key, label] of metrics) {
            const item = node('div'); item.append(node('dt', label), node('dd', data[key] == null ? 'Không có quyền xem' : data[key])); list.append(item);
        }
        output.append(list, node('p', `Cập nhật: ${date(data.generatedAt)}`, 'account-role-note'), node('p', 'Thống kê bài kiểm tra chính thức chỉ tính dữ liệu chấm trên máy chủ. Mở mục Tiến độ tự học để xem bản tự báo cáo từ các bài và lab hiện tại.', 'account-role-note'));
        const retry = node('button', 'Làm mới', 'btn btn--ghost'); retry.type = 'button'; retry.addEventListener('click', () => this.loadManagement('overview')); output.append(retry);
    }
    search(output, mode, value) {
        const form = node('form', undefined, 'account-search'), label = node('label', mode === 'users' ? 'Tên hoặc email học viên' : 'Tên khóa học');
        const input = node('input'); input.type = 'search'; input.value = value; input.maxLength = 100;
        label.append(input); const button = node('button', 'Tìm kiếm', 'btn btn--ghost'); button.type = 'submit'; form.append(label, button);
        form.addEventListener('submit', event => { event.preventDefault(); this.loadManagement(mode, { search: input.value.trim() }); }); output.append(form);
    }
    table(output, headers, rows) {
        const wrap = node('div', undefined, 'account-table-wrap'); wrap.tabIndex = 0;
        const table = node('table', undefined, 'account-table'), head = node('thead'), headRow = node('tr');
        for (const label of headers) { const cell = node('th', label); cell.scope = 'col'; headRow.append(cell); } head.append(headRow);
        const body = node('tbody');
        for (const row of rows) {
            const tr = node('tr');
            for (const value of row) {
                const td = node('td');
                if (value instanceof Node) td.append(value);
                else td.textContent = value ?? '—';
                tr.append(td);
            }
            body.append(tr);
        }
        table.append(head, body); wrap.append(table); output.append(wrap);
    }
    users(output, rows, version, query) {
        const actor = accountService.user;
        const tableRows = rows.map(user => {
            const action = node('div', undefined, 'account-student-actions');
            if (user.approvalPending) {
                if (canApproveStudent(actor, user, { offline: accountService.sessionOffline })) {
                    const approve = node('button', 'Duyệt học sinh', 'btn btn--primary btn--sm'); approve.type = 'button'; approve.dataset.studentApprove = user.id;
                    approve.addEventListener('click', async () => {
                        if (version !== this.managementVersion || accountService.user?.id !== actor.id || !canApproveStudent(accountService.user, user, { offline: accountService.sessionOffline })) return;
                        if (!confirm(`Duyệt tài khoản học sinh ${nameOf(user)} (${user.email})? Bạn xác nhận đây là học sinh được phép tham gia hệ thống.`)) return;
                        approve.disabled = true;
                        try {
                            await accountService.request(`/v1/users/${encodeURIComponent(user.id)}/approve-student`, { method: 'POST' });
                            if (version !== this.managementVersion || accountService.user?.id !== actor.id) return;
                            this.message('Đã duyệt tài khoản. Học sinh có thể đăng nhập và học ngay.');
                            this.loadManagement('users', query);
                        } catch (error) { if (version === this.managementVersion) { this.message(accountErrorMessage(error), 'error'); approve.disabled = false; } }
                    }); action.append(approve);
                } else action.append(node('span', 'Chờ quản trị viên duyệt'));
            } else if (canUpdateStudentStatus(actor, user, { offline: accountService.sessionOffline })) {
                const button = node('button', user.isActive ? 'Khóa học viên' : 'Mở khóa học viên', 'btn btn--ghost btn--sm'); button.type = 'button'; button.dataset.studentStatus = user.id;
                button.addEventListener('click', async () => {
                    if (version !== this.managementVersion || accountService.user?.id !== actor.id) return;
                    if (!confirm(`${user.isActive ? 'Khóa' : 'Mở khóa'} tài khoản ${user.email}? ${user.isActive ? 'Các phiên hiện tại sẽ bị thu hồi.' : 'Học sinh có thể đăng nhập lại.'}`)) return;
                    button.disabled = true;
                    try {
                        await accountService.request(`/v1/users/${encodeURIComponent(user.id)}/status`, { method: 'PATCH', body: { isActive: !user.isActive } });
                        if (version === this.managementVersion && accountService.user?.id === actor.id) this.loadManagement('users', query);
                    } catch (error) { if (version === this.managementVersion) { this.message(accountErrorMessage(error), 'error'); button.disabled = false; } }
                }); action.append(button);
                if (this.authOptions.managedAccountsEnabled && user.isActive && actor.permissions?.includes('users:update')) {
                    const password = node('button', 'Đặt mật khẩu', 'btn btn--ghost btn--sm'); password.type = 'button'; password.dataset.studentPassword = user.id;
                    password.addEventListener('click', () => {
                        if (version !== this.managementVersion || accountService.user?.id !== actor.id) return;
                        this.passwordTarget = { ...user, ownerId: actor.id };
                        this.$('#account-student-password-identity').textContent = `${nameOf(user)} · ${user.email}`;
                        this.$('#student-new-password').value = ''; this.$('#student-password-confirm').checked = false;
                        this.$('#account-student-password-dialog').showModal(); this.$('#student-new-password').focus();
                    }); action.append(password);
                }
            } else action.append(node('span', user.id === actor.id ? 'Tài khoản đang dùng' : 'Chỉ xem'));
            const identity = node('div', undefined, 'account-student-name'); identity.append(node('strong', nameOf(user)), node('span', user.email));
            const state = node('span', user.approvalPending ? 'Chờ duyệt' : user.isActive ? 'Đang học' : 'Đã khóa', 'account-state'); state.dataset.state = user.approvalPending ? 'pending' : user.isActive ? 'active' : 'locked';
            const progress = node('div', undefined, 'account-student-progress'), summary = user.progressSummary;
            if (summary && Number.isFinite(summary.completed) && Number.isFinite(summary.total)) {
                progress.append(node('strong', `${summary.completed}/${summary.total} bài`));
                const meter = node('progress'); meter.max = summary.total || 30; meter.value = summary.completed; meter.setAttribute('aria-label', `${nameOf(user)}: ${summary.completed}/${summary.total} bài`); progress.append(meter);
                const details = node('details'); details.append(node('summary', 'Xem từng khóa'));
                for (const course of summary.courses || []) details.append(node('p', `${course.courseName || course.courseId}: ${course.completed}/${course.total} bài`));
                progress.append(details);
            } else progress.append(node('span', 'Chưa có bản lưu'));
            progress.append(node('small', user.lastLearningAt ? `Học gần nhất: ${date(user.lastLearningAt)}` : 'Chưa có hoạt động học tập'));
            return [identity, state, progress, date(user.lastLoginAt), action];
        });
        this.table(output, ['Học sinh', 'Trạng thái', 'Tiến độ tự học', 'Đăng nhập gần nhất', 'Thao tác'], tableRows);
    }
    createStudentForm(output, version) {
        const actor = accountService.user, access = workspaceAccess(actor, { offline: accountService.sessionOffline });
        if (!this.authOptions.managedAccountsEnabled || !access.manager || !actor?.isEmailVerified || !actor.permissions?.includes('users:create')) return;
        const details = node('details', undefined, 'account-create-student'), summary = node('summary', 'Tạo tài khoản học sinh');
        details.append(summary, node('p', 'Tài khoản này chỉ có quyền học sinh. Bạn xác nhận danh tính học sinh thay cho email và cung cấp thông tin đăng nhập qua kênh riêng.'));
        const form = node('form', undefined, 'account-form'); form.id = 'account-create-student'; form.method = 'post';
        for (const [name, text, type, autocomplete] of [['firstName', 'Tên học sinh', 'text', 'off'], ['lastName', 'Họ và tên đệm', 'text', 'off'], ['email', 'Email / tên đăng nhập', 'email', 'off'], ['password', 'Mật khẩu ban đầu', 'password', 'new-password']]) {
            const label = node('label', text, 'field'), input = node('input');
            input.name = name; input.type = type; input.autocomplete = autocomplete; input.required = true;
            input.maxLength = name === 'password' ? 72 : name === 'email' ? 255 : 100;
            if (name === 'password') input.minLength = 12;
            label.append(input); form.append(label);
        }
        const confirmation = node('label', undefined, 'account-check'), checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.required = true;
        confirmation.append(checkbox, node('span', 'Tôi đã xác nhận đúng học sinh và sẽ cung cấp thông tin đăng nhập an toàn.'));
        const submit = node('button', 'Tạo tài khoản học sinh', 'btn btn--primary'); submit.type = 'submit';
        form.append(confirmation, submit); details.append(form); output.append(details);
        this.bindForm('#account-create-student', async (data, { isCurrent }) => {
            if (version !== this.managementVersion) return;
            await accountService.request('/v1/users/students', { method: 'POST', body: { email: data.email, password: data.password, firstName: data.firstName, lastName: data.lastName } });
            if (!isCurrent() || version !== this.managementVersion) return;
            this.message('Đã tạo tài khoản học sinh được xác nhận. Cung cấp thông tin đăng nhập qua kênh riêng; không gửi mật khẩu vào nhóm công khai.');
            this.loadManagement('users');
        });
    }
    courses(output, rows, version) {
        const list = node('ul', undefined, 'account-course-list');
        for (const course of rows) {
            const item = node('li'); item.append(node('h3', course.title), node('p', `${course._count?.lessons ?? 0} bài học · ${course._count?.enrollments ?? 0} lượt ghi danh`));
            const button = node('button', 'Xem học viên', 'btn btn--ghost'), roster = node('div'); button.type = 'button';
            button.addEventListener('click', async () => {
                button.disabled = true; roster.replaceChildren(node('p', 'Đang tải học viên…'));
                try {
                    const data = await accountService.request(`/v1/teacher/courses/${encodeURIComponent(course.id)}/students?limit=100`);
                    if (version !== this.managementVersion) return;
                    const students = rowsOf(data); roster.replaceChildren();
                    if (!students.length) roster.append(node('p', 'Khóa học chưa có học viên đang ghi danh.'));
                    else {
                        this.table(roster, ['Học viên', 'Ghi danh', 'Hoàn thành khóa'], students.map(row => [nameOf(row.user), date(row.enrolled_at), row.completed_at ? date(row.completed_at) : 'Đang học']));
                        if (students.length === 100) roster.append(node('p', 'Đang hiển thị 100 học viên đầu tiên.'));
                    }
                } catch (error) { roster.replaceChildren(node('p', accountErrorMessage(error))); }
                finally { button.disabled = false; }
            });
            const progress = node('button', 'Xem tiến độ tự học', 'btn btn--ghost'), summaries = node('div'); progress.type = 'button';
            progress.addEventListener('click', async () => {
                progress.disabled = true; summaries.replaceChildren(node('p', 'Đang tải tóm tắt tự học…'));
                try {
                    const data = await accountService.request(`/v1/learner-state/management?courseId=${encodeURIComponent(course.id)}&limit=100`);
                    if (version !== this.managementVersion) return;
                    const learners = rowsOf(data); summaries.replaceChildren();
                    if (!learners.length) summaries.append(node('p', 'Chưa có tóm tắt tự học của học viên đang tham gia.'));
                    else { this.learningSummaries(summaries, learners); if (learners.length === 100) summaries.append(node('p', 'Đang hiển thị 100 học viên đầu tiên.')); }
                } catch (error) { if (version === this.managementVersion) summaries.replaceChildren(node('p', accountErrorMessage(error))); }
                finally { progress.disabled = false; }
            });
            item.append(button, roster, progress, summaries); list.append(item);
        }
        output.append(list);
    }
    learningSummaries(output, learners) {
        output.append(node('p', 'Dữ liệu người học tự báo cáo; chưa phải điểm hay kết quả được giáo viên xác nhận. Nhật ký và mã dự án riêng không được hiển thị.', 'account-role-note'));
        const rows = learners.flatMap(learner => learner.courses?.length ? learner.courses.map(course => [learner.displayName, course.courseId, `${course.completedLessons}/${course.totalLessons}`, course.savedLessons, course.quizAttempts, course.practiceAttempts, date(learner.updatedAt)]) : [[learner.displayName, 'Chưa có bài lưu', '0', '0', '0', '0', date(learner.updatedAt)]]);
        this.table(output, ['Học viên', 'Khóa', 'Bài tự hoàn thành', 'Bài có bản lưu', 'Lượt tự kiểm tra', 'Lượt thực hành', 'Cập nhật'], rows);
    }
    pagination(output, mode, page, search, hasNext) {
        const actions = node('div', undefined, 'account-actions');
        const previous = node('button', 'Trang trước', 'btn btn--ghost'), next = node('button', 'Trang sau', 'btn btn--ghost');
        previous.type = next.type = 'button'; previous.disabled = page <= 1; next.disabled = !hasNext;
        previous.addEventListener('click', () => this.loadManagement(mode, { page: page - 1, search }));
        next.addEventListener('click', () => this.loadManagement(mode, { page: page + 1, search }));
        actions.append(previous, node('span', `Trang ${page}`), next); output.append(actions);
    }
}

const start = () => { if (document.querySelector('#account-auth')) new AccountPage().init(); };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
