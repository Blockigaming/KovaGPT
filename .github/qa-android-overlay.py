from pathlib import Path

root = Path.cwd()
source = root / "android/app/src/main/java/com/kovagpt/chat/KovaChatActivity.java"
activity = source.read_text()
def insert(old, new):
    global activity
    assert activity.count(old) == 1, old
    activity = activity.replace(old, new, 1)

insert('    private WebView web;', '''    private WebView web;
    // Temporary lab entry. The production origin checks and native bridge are unchanged.
    private String qaHost;

    private void configureQaStart(Bundle savedState) {
        if (savedState != null) qaHost = savedState.getString("qa-host");
    }

    private void showQaPreview() {
        android.widget.EditText input = new android.widget.EditText(this);
        input.setHint("Synthetic preview URL");
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        android.app.AlertDialog prompt = new android.app.AlertDialog.Builder(this)
            .setTitle("KovaGPT device verification")
            .setView(input)
            .setPositiveButton("Open preview", null)
            .create();
        prompt.setOnShowListener(event -> prompt.getButton(android.app.AlertDialog.BUTTON_POSITIVE)
            .setOnClickListener(view -> {
                String value = input.getText().toString().trim();
                Uri target = Uri.parse(value);
                String host = target.getHost();
                if (host == null || !value.matches("https://[a-z0-9-]+\\\\.trycloudflare\\\\.com/_qa/[0-9a-f]{64}")) {
                    input.setError("Enter the full temporary preview URL");
                    return;
                }
                qaHost = host;
                prompt.dismiss();
                web.loadUrl(value);
            }));
        prompt.show();
    }''')
insert('        super.onCreate(savedState);','        super.onCreate(savedState);\n        configureQaStart(savedState);')
insert('            open(initial == null ? KovaDestination.CHAT : initial);','            showQaPreview();')
insert('                Uri url = request.getUrl();','''                Uri url = request.getUrl();
                if (qaHost != null) {
                    return !("https".equals(url.getScheme()) && qaHost.equals(url.getHost())
                        && url.getUserInfo() == null && (url.getPort() == -1 || url.getPort() == 443));
                }''')
insert('        web.saveState(state);','        state.putString("qa-host", qaHost);\n        web.saveState(state);')

source.write_text(activity)
gradle = root / "android/app/build.gradle"
gradle.write_text(gradle.read_text().replace("applicationId 'com.kovagpt.chat'", "applicationId 'com.kovagpt.chat.qa'"))
