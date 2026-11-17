#!/usr/bin/env python3
"""Exercise admin AI setup UI with a local, deterministic API fixture; no provider calls."""
import argparse
import json
import urllib.parse
from playwright.sync_api import expect, sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:5500')
    parser.add_argument('--chromium', default='/usr/bin/chromium')
    args = parser.parse_args()
    assert urllib.parse.urlsplit(args.base).hostname in ['localhost', '127.0.0.1']
    base = args.base.rstrip('/')
    secret = 'Fixture-Provider-Secret-2026'
    source = '''<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="../src/assets/css/variables.css"><link rel="stylesheet" href="../src/assets/css/base.css">
<link rel="stylesheet" href="../src/assets/css/components.css"><div id="setup"></div><script type="module">
import {attachAiAdminSetup, AI_SETUP_TOOLS} from '../src/modules/account/AiAdminSetup.js';
const admin={id:'fixture-operator',email:'fixture-operator@school.local',isActive:true,isEmailVerified:true,permissions:['ai:manage','ai:chat','system:read'],roles:[{group:'MANAGER',scopeType:'SYSTEM'}]};
const listeners=[]; const clone=x=>JSON.parse(JSON.stringify(x));
const state={vault:{revision:0,providers:[]},models:[{id:'fixture-old-model-record',provider_id:'gemini',model_id:'fixture-old-model',enabled:false,is_default:false,max_input_tokens:6000,max_output_tokens:2048,context_tokens:8192}],enabled:false,credentials:0,events:0};
const calls=[]; let release;
window.fake={state,calls,nextPause:false,release:()=>release?.(),changeUser(user){session.user=user;session.sessionVersion++;listeners.forEach(fn=>fn(user));}};
const session={user:admin,sessionVersion:1,sessionOffline:false,subscribe(fn){listeners.push(fn);return()=>{};},async request(path,options={}){
 calls.push({path,method:options.method||'GET',body:options.body?clone(options.body):null});
 if(path==='/v1/admin/ai/settings'){if(options.method==='PATCH')state.enabled=options.body.enabled;return {enabled:state.enabled,gatewayEnabled:true};}
 if(path==='/v1/admin/ai/vault')return clone(state.vault);
 if(path==='/v1/admin/ai/models'){
   if(options.method==='POST'){const body=options.body;const row={id:'fixture-model-record',provider_id:body.providerId,model_id:body.modelId,enabled:true,is_default:true,max_input_tokens:body.maxInputTokens,max_output_tokens:body.maxOutputTokens,context_tokens:body.contextTokens};state.models.push(row);return clone(row);}
   return clone(state.models);
 }
 if(path==='/v1/admin/ai/models/fixture-model-record'){const body=options.body;const row=state.models.find(model=>model.id==='fixture-model-record');Object.assign(row,{max_input_tokens:body.maxInputTokens,max_output_tokens:body.maxOutputTokens,context_tokens:body.contextTokens});return clone(row);}
 if(path==='/v1/admin/ai/quotas/default')return {daily_requests:50,daily_tokens:100000};
 if(path.startsWith('/v1/ai/agent/capabilities'))return AI_SETUP_TOOLS.map(name=>({name}));
 if(path==='/v1/admin/ai/providers/gemini/models')return {modelIds:['fixture-model']};
 if(path.endsWith('/config')){
   const previous=state.vault.providers[0];state.vault.providers=[{...options.body.provider,credentials:previous?.credentials||[]}];state.vault.revision++;
   if(window.fake.nextPause){window.fake.nextPause=false;await new Promise(resolve=>release=resolve);}
   return clone(state.vault);
 }
 if(path.endsWith('/credentials')){state.credentials++;state.vault.providers[0].credentials.push({id:'fixture-credential',enabled:true});state.vault.revision++;return clone(state.vault);}
 throw new Error('Unexpected fixture API path');
}};
document.addEventListener('strobot:agent-settings-changed',()=>state.events++);
attachAiAdminSetup(document.querySelector('#setup'),session);
</script></html>'''
    errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.chromium, headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage'])
        context = browser.new_context(viewport={'width': 1440, 'height': 1000})
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))

        def route_request(route):
            url = urllib.parse.urlsplit(route.request.url)
            if url.path.endswith('/ai-setup-fixture.html'):
                route.fulfill(status=200, content_type='text/html', body=source)
            elif url.netloc == urllib.parse.urlsplit(base).netloc:
                route.continue_()
            else:
                raise AssertionError('Unexpected external request during AI setup regression')
        context.route('**/*', route_request)
        page.goto(base + '/frontend/public/ai-setup-fixture.html', wait_until='domcontentloaded')
        expect(page.locator('.ai-admin-status')).to_contain_text('Đã đọc cấu hình')
        form = page.locator('[data-ai-setup-form]')
        expect(form).to_have_attribute('method', 'post')
        expect(form.locator('[name="apiKey"]')).to_have_attribute('type', 'password')
        expect(form.locator('[name="apiKey"]')).to_have_attribute('autocomplete', 'new-password')
        expect(form.locator('[name="modelId"]')).to_have_attribute('autocomplete', 'off')
        for name, value in [('maxInputTokens', '32768'), ('maxOutputTokens', '2048'), ('contextTokens', '65536')]:
            expect(form.locator('[name="' + name + '"]')).to_have_value(value)
        expect(page.locator('#setup')).to_contain_text('cửa sổ ngữ cảnh ít nhất 65.536')
        expect(page.locator('#setup')).to_contain_text('đang lưu giới hạn đầu vào 6000')
        assert page.evaluate('fake.calls.every(call=>!call.path.includes("/providers/"))')
        assert page.evaluate('fake.calls.every(call=>call.method==="GET")'), 'Loading metadata must not increase old limits'
        old_model = page.evaluate('fake.state.models[0]')

        # Browser autofill must not turn an operator email into a provider model.
        calls_before_invalid = page.evaluate('fake.calls.length')
        form.locator('[name="modelId"]').fill('fixture-operator@school.local')
        form.locator('[name="apiKey"]').fill(secret)
        form.locator('input[type="checkbox"]').nth(1).check()
        form.get_by_role('button', name='Lưu kết nối / mô hình', exact=True).click()
        expect(page.locator('.ai-admin-status')).to_contain_text('email đăng nhập')
        expect(form.locator('[name="apiKey"]')).to_have_value('')
        assert page.evaluate('fake.calls.length') == calls_before_invalid
        assert page.evaluate('fake.state.models[0]') == old_model
        form.locator('[name="modelId"]').fill('')
        form.locator('[name="apiKey"]').fill(secret)
        form.locator('input[type="checkbox"]').nth(1).check()
        form.get_by_role('button', name='Lưu kết nối / mô hình', exact=True).click()
        expect(form.locator('[name="apiKey"]')).to_have_value('')
        expect(page.locator('.ai-admin-status')).to_contain_text('Đã lưu kết nối.')
        assert page.evaluate('fake.state.credentials') == 1
        assert secret not in page.locator('body').inner_text()
        assert secret not in page.url
        assert page.evaluate('''secret=>![...Object.values(localStorage),...Object.values(sessionStorage)].some(value=>String(value).includes(secret))''', secret)
        form.get_by_role('button', name='Tra ID mô hình từ nhà cung cấp', exact=True).click()
        expect(page.locator('.ai-admin-status')).to_contain_text('Đã nhận 1 ID')
        form.locator('[name="modelId"]').fill('fixture-model')

        # Registering tools with too little output is rejected before any write.
        calls_before_invalid = page.evaluate('fake.calls.length')
        form.locator('[name="maxOutputTokens"]').fill('1199')
        form.locator('input[type="checkbox"]').nth(1).check()
        form.get_by_role('button', name='Lưu kết nối / mô hình', exact=True).click()
        expect(page.locator('.ai-admin-status')).to_contain_text('ít nhất 1.200')
        assert page.evaluate('fake.calls.length') == calls_before_invalid
        for name, value in [('maxInputTokens', '6000'), ('maxOutputTokens', '1200'), ('contextTokens', '8192')]:
            form.locator('[name="' + name + '"]').fill(value)
        form.locator('input[type="checkbox"]').nth(1).check()
        form.get_by_role('button', name='Lưu kết nối / mô hình', exact=True).click()
        expect(page.locator('.ai-admin-status')).to_contain_text('Đã lưu kết nối và mô hình')
        assert page.evaluate('fake.state.credentials') == 1, 'An empty key must preserve saved credentials'
        model_body = page.evaluate('fake.calls.find(call=>call.path==="/v1/admin/ai/models"&&call.method==="POST").body')
        assert 'learning_get_own_learning_data' in model_body['allowedTools']
        assert 'learning_get_lab_platforms' in model_body['allowedTools']
        assert [model_body['maxInputTokens'], model_body['maxOutputTokens'], model_body['contextTokens']] == [6000, 1200, 8192]

        # Explicitly changing the visible values updates the same stored model.
        for name, value in [('maxInputTokens', '32768'), ('maxOutputTokens', '2048'), ('contextTokens', '65536')]:
            form.locator('[name="' + name + '"]').fill(value)
        form.locator('input[type="checkbox"]').nth(1).check()
        form.get_by_role('button', name='Lưu kết nối / mô hình', exact=True).click()
        expect(page.locator('.ai-admin-status')).to_contain_text('Đã lưu kết nối và mô hình')
        model_patch = page.evaluate('fake.calls.find(call=>call.path==="/v1/admin/ai/models/fixture-model-record"&&call.method==="PATCH").body')
        assert [model_patch['maxInputTokens'], model_patch['maxOutputTokens'], model_patch['contextTokens']] == [32768, 2048, 65536]
        assert page.evaluate('fake.state.models[0]') == old_model, 'A different old model must never be auto-updated'
        writes_before_refresh = page.evaluate('fake.calls.filter(call=>call.method!=="GET").length')
        form.get_by_role('button', name='Tải lại trạng thái', exact=True).click()
        expect(page.locator('.ai-admin-status')).to_contain_text('Đã đọc cấu hình')
        assert page.evaluate('fake.calls.filter(call=>call.method!=="GET").length') == writes_before_refresh
        assert page.evaluate('fake.state.models[0]') == old_model
        form.get_by_role('button', name='Bật agent', exact=True).click()
        expect(page.locator('.ai-admin-status')).to_contain_text('Đã bật cờ chat')
        assert page.evaluate('fake.state.enabled && fake.state.events===1')
        assert page.evaluate('fake.calls.every(call=>!call.path.endsWith("/chat"))')
        page.set_viewport_size({'width': 390, 'height': 844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')

        # Revoking authority during a save stops before the credential request.
        config_calls = page.evaluate('fake.calls.filter(call=>call.path.endsWith("/config")).length')
        page.evaluate('fake.nextPause=true')
        form.locator('[name="apiKey"]').fill(secret)
        form.locator('input[type="checkbox"]').nth(1).check()
        form.get_by_role('button', name='Lưu kết nối / mô hình', exact=True).click()
        page.wait_for_function('count=>fake.calls.filter(call=>call.path.endsWith("/config")).length===count', arg=config_calls + 1)
        page.evaluate('fake.changeUser({id:"fixture-student",isEmailVerified:true,permissions:[],roles:[{group:"STUDENT",scopeType:"SELF"}]});fake.release()')
        expect(page.locator('#setup')).to_be_empty()
        page.wait_for_timeout(150)
        assert page.evaluate('fake.state.credentials') == 1
        assert not errors, errors
        browser.close()
    print('PASS AI setup UI: metadata-only load, autofill rejection, editable model limits and explicit updates, encrypted key routing, activation, mobile and revoked-authority guards')


if __name__ == '__main__':
    main()
