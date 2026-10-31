"""Extract the frozen schema and produce strict Pydantic DTOs. No business rules."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'contracts/AI_SERVICE_CONTRACT.md'
text = SOURCE.read_text()
registry = next(json.loads(b) for b in re.findall(r'```json\n(.*?)\n```', text, re.S) if '"$defs"' in b)
(ROOT / 'contracts/schema.json').write_text(json.dumps(registry, indent=2) + '\n')
# Normalize anonymous object definitions to named classes; preserve all constraints.
definitions = dict(registry['$defs'])

def normalize(schema, name):
    if isinstance(schema, dict):
        if schema.get('type') == 'object':
            props = {k: normalize(v, name + ''.join(p.title() for p in k.split('_'))) for k, v in schema['properties'].items()}
            definitions[name] = dict(schema, properties=props)
            return {'$ref': '#/$defs/' + name}
        if schema.get('type') == 'array':
            return dict(schema, items=normalize(schema['items'], name + 'Item'))
        return {k: [normalize(v, name) for v in value] if k in ('anyOf', 'oneOf') else value for k, value in schema.items()}
    return schema

for name, value in list(definitions.items()):
    normalize(value, name)

def annotation(s):
    if '$ref' in s:
        return s['$ref'].split('/')[-1]
    for union in ('anyOf', 'oneOf'):
        if union in s:
            return 'Union[' + ', '.join(annotation(x) for x in s[union]) + ']'
    if 'enum' in s:
        return 'Literal[' + ', '.join(repr(x) for x in s['enum']) + ']'
    kind = s['type']
    if isinstance(kind, list):
        return 'Union[' + ', '.join(annotation({'type': x}) for x in kind) + ']'
    if s.get('format') == 'date-time': return 'UTCString'
    if s.get('format') == 'date': return 'DateString'
    base = {'string': 'str', 'integer': 'int', 'number': 'float', 'boolean': 'bool', 'null': 'None', 'array': 'List'}[kind]
    if kind == 'array': base += '[' + annotation(s['items']) + ']'
    constraints = []
    for key, field in [('minimum', 'ge'), ('maximum', 'le'), ('minLength', 'min_length'), ('maxLength', 'max_length'), ('maxItems', 'max_length'), ('pattern', 'pattern')]:
        if key in s: constraints.append(field + '=' + repr(s[key]))
    return 'Annotated[' + base + ', Field(' + ', '.join(constraints) + ')]' if constraints else base

header = '''# Generated from contracts/schema.json by scripts/extract_contract.py.
# Do not change DTO fields independently of the frozen contract.
from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, List, Literal, Union

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, RootModel, model_validator


def valid_utc(value: str) -> str:
    if not value.endswith("Z"):
        raise ValueError("Timestamp must use UTC Z")
    datetime.fromisoformat(value[:-1] + "+00:00")
    return value


def valid_date(value: str) -> str:
    date.fromisoformat(value)
    return value


UTCString = Annotated[str, Field(pattern=r"^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$"), AfterValidator(valid_utc)]
DateString = Annotated[str, Field(pattern=r"^\\d{4}-\\d{2}-\\d{2}$"), AfterValidator(valid_date)]


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
'''
parts = [header]
emitted = set()

def emit(name):
    if name in emitted: return
    s = definitions[name]
    def dependencies(node):
        if isinstance(node, dict):
            if '$ref' in node: yield node['$ref'].split('/')[-1]
            for v in node.values(): yield from dependencies(v)
        elif isinstance(node, list):
            for v in node: yield from dependencies(v)
    for dep in dependencies(s): emit(dep)
    if s.get('type') == 'object':
        lines = ['\n\nclass ' + name + '(ContractModel):']
        lines += ['    ' + field + ': ' + annotation(prop) for field, prop in s['properties'].items()]
        if name == 'ReviewRequest':
            lines += ['','    @model_validator(mode="after")','    def check_combination(self):','        if self.decision == "edit":','            if self.edited_message is None or self.delivery != "draft_only":','                raise ValueError("Edit requires edited_message and draft_only delivery")','        elif self.edited_message is not None:','            raise ValueError("Approve and reject require edited_message=null")','        if self.decision == "reject" and self.delivery != "draft_only":','            raise ValueError("Reject requires draft_only delivery")','        return self']
        parts.append('\n'.join(lines))
    else:
        parts.append('\n\nclass ' + name + '(RootModel[' + annotation(s) + ']):\n    model_config = ConfigDict(strict=True)')
    emitted.add(name)

for name in definitions: emit(name)
(ROOT / 'app/models.py').write_text('\n'.join(parts) + '\n')
print('Extracted', len(registry['$defs']), 'contract schemas')
