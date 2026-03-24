#!/usr/bin/env python3
import re
import sys

path = sys.argv[1] if len(sys.argv)>1 else '/tmp/WhatsApp Chat with +44 7841 917809.txt'

def parse_whatsapp_export(text):
    lines = re.split(r"\r?\n", text)
    msg_start = re.compile(r'^(?:\[)?(\d{1,2}/\d{1,2}/\d{2,4}|\d{4}-\d{2}-\d{2})[,\s\-T]+\d{1,2}:\d{2}')

    messages = []
    current = None
    for line in lines:
        if msg_start.match(line):
            if current: messages.append(current)
            current = {'raw': line}
        else:
            if current: current['raw'] += '\n' + line
    if current: messages.append(current)

    per_sender = {}
    media_count = 0
    system_re = re.compile(r'(messages and calls are end-to-end encrypted|messages to this chat and calls are now secured|this message was deleted|changed the subject|changed the group description|joined using this group\'s invite link|created group|added|removed|left|was added|was removed|were added|changed the subject|changed the group icon)', re.I)

    for m in messages:
        parts = m['raw'].split(' - ', 1)
        rest = parts[1] if len(parts)>1 else ''
        sender = 'Unknown'
        text = ''
        if rest:
            if ':' in rest:
                idx = rest.find(':')
                sender = rest[:idx].strip()
                text = rest[idx+1:].strip()
            else:
                text = rest.strip()
        else:
            alt = m['raw'].split('] ', 1)
            if len(alt)>1:
                after = alt[1]
                if ':' in after:
                    idx = after.find(':')
                    sender = after[:idx].strip()
                    text = after[idx+1:].strip()

        is_system = False
        if sender == 'Unknown':
            if not text or system_re.search(text or ''):
                is_system = True

        if is_system:
            continue

        if sender not in per_sender:
            per_sender[sender] = {'count':0, 'media':0}
        per_sender[sender]['count'] += 1
        if re.search(r'<Media omitted>|<arquivo de mídia omitido>|<arquivo de mídia omitido>', text, re.I):
            media_count += 1
            per_sender[sender]['media'] += 1

    total = sum(info['count'] for info in per_sender.values())
    return total, len(per_sender), media_count, per_sender

if __name__ == '__main__':
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        text = f.read()
    total, senders, media, per_sender = parse_whatsapp_export(text)
    print('Total messages:', total)
    print('Unique senders:', senders)
    print('Media messages:', media)
    print('\nTop senders:')
    for s,info in sorted(per_sender.items(), key=lambda x:-x[1]['count']):
        print(f'  {s}: {info["count"]} (media: {info["media"]})')
