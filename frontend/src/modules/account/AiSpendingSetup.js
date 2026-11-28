import { accountService } from '../../services/AccountService.js';

const API = '/v1/admin/ai/spending';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const allowed = (user, offline = false) => Boolean(user?.id && user.isActive !== false && user.isEmailVerified && !offline
    && user.permissions?.includes('ai:manage')
    && user.roles?.some(role => role.group === 'MANAGER' && role.scopeType === 'SYSTEM'));
const fail = (code, status = 400) => Object.assign(new Error(code), { code, status });
const priceKnown = model => String(model?.pricingVersion || '').startsWith('operator-confirmed:')
    && model.inputPricePerMillion !== null && model.inputPricePerMillion !== undefined
    && model.outputPricePerMillion !== null && model.outputPricePerMillion !== undefined;
const money = (value, minimum, maximum = 1000) => {
    const text = String(value ?? '').trim();
    if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,8})?$/.test(text) || Number(text) < minimum || Number(text) > maximum)
        throw fail('AI_SPENDING_MONEY');
    return text;
};
const iso = value => {
    const date = new Date(value);
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) || !Number.isFinite(date.getTime())) throw fail('AI_SPENDING_DATES');
    return date.toISOString();
};

export function defaultAiSpending(now = new Date()) {
    let year = new Date(now.getTime() + 7 * 3600000).getUTCFullYear();
    if (now >= new Date(`${year}-12-13T00:00:00+07:00`)) year++;
    const reserveFrom = new Date(`${year}-12-12T00:00:00+07:00`);
    return { enabled: false, economyEnabled: true, totalBudgetUsd: '1.00', dailyBudgetUsd: '0.03', reserveUsd: '0.40',
        startsAt: new Date(Math.min(now.getTime(), reserveFrom.getTime() - 1)).toISOString(),
        reserveFrom: reserveFrom.toISOString(), endsAt: new Date(`${year}-12-13T00:00:00+07:00`).toISOString(), revision: 0 };
}

/** The operator supplies provider prices. No USD estimate is invented from model names or token counts. */
export function validateAiSpending(value, status = {}, now = new Date()) {
    if (typeof value?.enabled !== 'boolean' || typeof value.economyEnabled !== 'boolean'
        || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0) throw fail('AI_SPENDING_INPUT');
    const result = { enabled: value.enabled, economyEnabled: value.economyEnabled,
        totalBudgetUsd: money(value.totalBudgetUsd, 0.00000001), dailyBudgetUsd: money(value.dailyBudgetUsd, 0.00000001),
        reserveUsd: money(value.reserveUsd, 0), startsAt: iso(value.startsAt), reserveFrom: iso(value.reserveFrom),
        endsAt: iso(value.endsAt), expectedRevision: value.expectedRevision };
    if (Number(result.dailyBudgetUsd) > Number(result.totalBudgetUsd) || Number(result.reserveUsd) > Number(result.totalBudgetUsd))
        throw fail('AI_SPENDING_MONEY');
    if (!(result.startsAt < result.reserveFrom && result.reserveFrom < result.endsAt)
        || (result.enabled && new Date(result.endsAt) <= now)) throw fail('AI_SPENDING_DATES');
    const wantsPrices = value.inputPricePerMillion !== undefined || value.outputPricePerMillion !== undefined || value.pricesConfirmed === true;
    const models = Array.isArray(status.models) ? status.models : [];
    if (wantsPrices) {
        if (!uuid(value.modelId) || !models.some(model => model.id === value.modelId) || value.pricesConfirmed !== true)
            throw fail('AI_SPENDING_PRICES');
        result.modelId = value.modelId;
        result.inputPricePerMillion = money(value.inputPricePerMillion, 0, 1000000);
        result.outputPricePerMillion = money(value.outputPricePerMillion, 0, 1000000);
        result.pricesConfirmed = true;
    }
    if (result.enabled && !wantsPrices && !models.some(priceKnown)) throw fail('AI_SPENDING_PRICES');
    return result;
}

export function aiSpendingErrorMessage(error) {
    if (error?.code === 'SESSION_CHANGED' || error?.status === 401 || error?.status === 403)
        return 'Phiên hoặc quyền quản trị đã thay đổi. Đăng nhập lại trước khi lưu hạn mức.';
    if (error?.code === 'AI_SPENDING_PRICES') return 'Cần đúng giá đầu vào và đầu ra từ nhà cung cấp, rồi xác nhận bảng giá trước khi bật chặn ngân sách.';
    if (error?.code === 'AI_SPENDING_MONEY') return 'Nhập số USD hợp lệ. Hạn mức mỗi ngày và khoản dành cho ngày thi không được lớn hơn ngân sách cả kỳ.';
    if (error?.code === 'AI_SPENDING_DATES') return 'Kiểm tra thời gian: bắt đầu trước ngày giữ credit, rồi đến thời điểm kết thúc. Kỳ đang bật cần còn hiệu lực.';
    if (error?.status === 409) return 'Hạn mức đã thay đổi ở nơi khác. Tải lại trạng thái trước khi lưu tiếp.';
    if (error?.status === 404) return 'Backend chưa có phần quản lý chi phí này. Cập nhật backend rồi tải lại trạng thái.';
    if (error?.status === 429) return 'Đã đạt giới hạn thao tác. Chờ một lúc rồi thử lại.';
    return 'Chưa lưu được hạn mức. Cấu hình đang dùng được giữ nguyên; tải lại trạng thái để kiểm tra.';
}

export class AiSpendingClient {
    constructor(session = accountService, canConfigure = allowed) { this.session = session; this.canConfigure = canConfigure; }
    scope() {
        const owner = this.session.user?.id, version = this.session.sessionVersion;
        const current = () => owner === this.session.user?.id && version === this.session.sessionVersion
            && this.canConfigure(this.session.user, this.session.sessionOffline);
        if (!current()) throw fail('SESSION_CHANGED', 403);
        return async options => {
            if (!current() || options?.signal?.aborted) throw fail('SESSION_CHANGED', 403);
            const result = await this.session.request(API, options);
            if (!current()) throw fail('SESSION_CHANGED', 403);
            return result;
        };
    }
    load(signal) { return this.scope()({ signal }); }
    async save(input, status, { signal, now } = {}) {
        const body = validateAiSpending(input, status, now);
        return this.scope()({ method: 'PUT', body, signal });
    }
}

const localInput = value => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
};
const usd = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 6 }) + ' USD' : 'chưa xác định';
const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
};
let nextPanel = 0;

/** Mount a closed metadata-only panel. Opening it is the first network operation. */
export function attachAiSpendingSetup(container, session = accountService, { canConfigure = allowed } = {}) {
    if (!container || !canConfigure(session.user, session.sessionOffline)) return () => {};
    const client = new AiSpendingClient(session, canConfigure), owner = session.user.id, version = session.sessionVersion;
    const prefix = 'ai-spending-' + ++nextPanel;
    let destroyed = false, busy = false, loaded = false, snapshot = null, controller, pricesTouched = false;
    const current = () => !destroyed && owner === session.user?.id && version === session.sessionVersion && canConfigure(session.user, session.sessionOffline);
    const details = element('details'); details.dataset.aiSpending = '';
    details.append(element('summary', 'Chi phí và hạn mức AI'));
    const body = element('div'), status = element('p', 'Chưa đọc hạn mức. Mở mục này để kiểm tra; không gửi câu hỏi tới AI.', 'field-hint');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const summary = element('div'), form = element('form'), fields = element('div', undefined, 'ai-admin-fields');
    form.dataset.aiSpendingForm = ''; form.method = 'post';
    const control = (name, label, type = 'number', target = fields) => {
        const wrap = element('div', undefined, 'field'), title = element('label', label, 'label'), input = element('input', undefined, 'input');
        input.name = name; input.id = prefix + '-' + name; input.type = type; title.htmlFor = input.id;
        if (type === 'number') { input.min = '0'; input.max = '1000'; input.step = 'any'; }
        wrap.append(title, input); target.append(wrap); return input;
    };
    const check = (name, text) => {
        const label = element('label', undefined, 'check'), input = element('input'); input.type = 'checkbox'; input.name = name;
        label.append(input, element('span', text)); form.append(label); return input;
    };
    const economy = check('economyEnabled', 'Bật chế độ tiết kiệm: rút gọn ngữ cảnh và giảm lượt gọi AI.');
    const enabled = check('enabled', 'Chặn lượt gọi mới khi đạt ngân sách của toàn website.');
    const total = control('totalBudgetUsd', 'Ngân sách cả kỳ (USD credit)'), daily = control('dailyBudgetUsd', 'Hạn mức trước ngày thi (USD/ngày)'), reserve = control('reserveUsd', 'Credit dành cho ngày thi (USD)');
    form.append(fields);
    const planning = element('details'); planning.append(element('summary', 'Thời gian sử dụng'));
    const timeFields = element('div', undefined, 'ai-admin-fields');
    const starts = control('startsAt', 'Bắt đầu tính ngân sách', 'datetime-local', timeFields);
    const reserveFrom = control('reserveFrom', 'Bắt đầu dùng phần dành cho ngày thi', 'datetime-local', timeFields);
    const ends = control('endsAt', 'Kết thúc kỳ sử dụng', 'datetime-local', timeFields);
    planning.append(timeFields, element('p', 'Thời gian theo thiết bị này. Từ mốc dành cho ngày thi, hạn mức ngày được nâng ít nhất bằng khoản dành riêng; tổng cả kỳ vẫn được giữ.', 'field-hint'));
    const pricing = element('details'); pricing.append(element('summary', 'Bảng giá model từ nhà cung cấp'));
    const priceFields = element('div', undefined, 'ai-admin-fields');
    const modelWrap = element('div', undefined, 'field'), modelLabel = element('label', 'Model đã đăng ký', 'label'), model = element('select', undefined, 'select');
    model.id = prefix + '-modelId'; model.name = 'modelId'; modelLabel.htmlFor = model.id; modelWrap.append(modelLabel, model); priceFields.append(modelWrap);
    const inputPrice = control('inputPricePerMillion', 'Giá đầu vào (USD / 1 triệu token)', 'number', priceFields);
    const outputPrice = control('outputPricePerMillion', 'Giá đầu ra (USD / 1 triệu token)', 'number', priceFields);
    inputPrice.max = outputPrice.max = '1000000';
    const priceNotice = element('p', '', 'field-hint'), confirmLabel = element('label', undefined, 'check'), confirmed = element('input');
    confirmed.type = 'checkbox'; confirmed.name = 'pricesConfirmed';
    confirmLabel.append(confirmed, element('span', 'Tôi đã đối chiếu đúng bảng giá của nhà cung cấp và đồng ý lưu các giá này.'));
    pricing.append(priceFields, priceNotice, confirmLabel, element('p', 'Mục này chỉ lưu bảng giá, không đổi model mặc định. Model chưa có giá được xác nhận sẽ bị chặn khi ngân sách đang bật.', 'field-hint'));
    const actions = element('div', undefined, 'ai-admin-actions'), save = element('button', 'Lưu chế độ và ngân sách', 'btn btn--primary'), refresh = element('button', 'Tải lại hạn mức', 'btn');
    save.type = 'submit'; refresh.type = 'button'; actions.append(save, refresh);
    form.append(planning, pricing, actions);
    body.append(element('p', 'Credit của nhà cung cấp tách biệt với phí ChatGPT. Hệ thống không đọc được ví Woku; giới hạn USD dựa trên bảng giá đã xác nhận, không phải số dư trực tiếp.', 'field-hint'), summary, form, status);
    details.append(body); container.append(details);
    const controls = () => {
        for (const input of form.querySelectorAll('input,select,button')) input.disabled = busy || !loaded || !current();
        refresh.disabled = busy || !current();
    };
    const renderPrices = () => {
        const selected = snapshot?.models?.find(item => item.id === model.value);
        inputPrice.value = selected?.inputPricePerMillion ?? ''; outputPrice.value = selected?.outputPricePerMillion ?? '';
        pricesTouched = false; confirmed.checked = false;
        priceNotice.textContent = priceKnown(selected) ? 'Model này đã có bảng giá được người quản trị xác nhận. Chỉ tích xác nhận khi muốn lưu lại giá.' : 'Chưa có bảng giá được xác nhận. Hỏi nhà cung cấp giá đầu vào/đầu ra trước khi bật chặn ngân sách.';
    };
    const render = result => {
        snapshot = result;
        const defaults = defaultAiSpending(), config = result.configuration || {}, usage = result.usage || {};
        if (!Number.isSafeInteger(config.revision) || config.revision < 0) throw fail('AI_SPENDING_RESPONSE');
        economy.checked = config.economyEnabled ?? defaults.economyEnabled; enabled.checked = config.enabled === true;
        total.value = config.totalBudgetUsd ?? defaults.totalBudgetUsd; daily.value = config.dailyBudgetUsd ?? defaults.dailyBudgetUsd; reserve.value = config.reserveUsd ?? defaults.reserveUsd;
        starts.value = localInput(config.startsAt || defaults.startsAt); reserveFrom.value = localInput(config.reserveFrom || defaults.reserveFrom); ends.value = localInput(config.endsAt || defaults.endsAt);
        model.replaceChildren();
        for (const item of (result.models || []).filter(item => uuid(item.id))) {
            const option = element('option', `${item.providerId} · ${item.modelId}`); option.value = item.id; model.append(option);
        }
        if (model.options.length) model.value = (result.models.find(item => item.isDefault)?.id || model.options[0].value);
        renderPrices(); summary.replaceChildren();
        summary.append(element('p', config.enabled ? 'Chặn ngân sách: đang bật cho toàn website.' : 'Chặn ngân sách: chưa bật. Chế độ tiết kiệm vẫn có thể dùng riêng.'));
        summary.append(element('p', `Đã ghi nhận: ${usd(usage.spentUsd)}; đang giữ chỗ: ${usd(usage.reservedUsd)}.`));
        summary.append(element('p', usage.costUnknown ? 'Có lượt chưa xác định được chi phí. Hệ thống không coi các lượt đó là miễn phí.' : `Còn trong hạn mức: ${usd(usage.remainingUsd)}; có thể dùng hôm nay: ${usd(usage.dailyRemainingUsd)}.`));
        loaded = true;
    };
    const load = async () => {
        if (!current() || busy) return;
        busy = true; controller?.abort(); controller = new AbortController(); controls();
        status.textContent = 'Đang đọc hạn mức; chưa gọi mô hình AI…';
        try {
            const result = await client.load(controller.signal);
            if (!current()) return;
            render(result); status.textContent = 'Đã đọc hạn mức. Các giá trị chỉ thay đổi khi bấm Lưu.';
        } catch (error) { if (current()) status.textContent = aiSpendingErrorMessage(error); }
        finally { if (current()) { busy = false; controls(); } }
    };
    details.addEventListener('toggle', () => { if (details.open && !loaded && !busy) void load(); });
    refresh.addEventListener('click', () => void load());
    model.addEventListener('change', renderPrices);
    for (const input of [inputPrice, outputPrice]) input.addEventListener('input', () => { pricesTouched = true; confirmed.checked = false; });
    form.addEventListener('submit', event => {
        event.preventDefault(); if (!current() || busy || !snapshot) return;
        if (pricesTouched && !confirmed.checked) { status.textContent = aiSpendingErrorMessage(fail('AI_SPENDING_PRICES')); pricing.open = true; return; }
        const input = { enabled: enabled.checked, economyEnabled: economy.checked, totalBudgetUsd: total.value, dailyBudgetUsd: daily.value, reserveUsd: reserve.value,
            startsAt: starts.value, reserveFrom: reserveFrom.value, endsAt: ends.value, expectedRevision: snapshot.configuration.revision,
            ...(confirmed.checked ? { modelId: model.value, inputPricePerMillion: inputPrice.value, outputPricePerMillion: outputPrice.value, pricesConfirmed: true } : {}) };
        busy = true; controller?.abort(); controller = new AbortController(); controls();
        void client.save(input, snapshot, { signal: controller.signal }).then(result => {
            if (!current()) return;
            render(result); status.textContent = 'Đã lưu chế độ và ngân sách. Chưa gửi câu hỏi thử hoặc thay khóa API.';
        }).catch(error => { if (current()) { status.textContent = aiSpendingErrorMessage(error); if (error.code === 'AI_SPENDING_PRICES') pricing.open = true; } })
            .finally(() => { if (current()) { busy = false; controls(); } });
    });
    const unsubscribe = session.subscribe?.(() => { if (!current()) { destroyed = true; controller?.abort(); container.replaceChildren(); } });
    controls();
    return () => { destroyed = true; controller?.abort(); unsubscribe?.(); container.replaceChildren(); };
}
