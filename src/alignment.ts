import * as vscode from 'vscode';


export function alignment(): void{
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
      return;
  }
  const selections = editor.selections;
  let selection = selections[0];
  let range = new vscode.Range(selection.start.line, 0, selection.end.character > 0 ? selection.end.line : selection.end.line - 1, 1024);
  let text = editor.document.getText(range);
  let recontruct = test_new(text);
  
  editor.edit((editBuilder) => {
    editBuilder.replace(range, recontruct);
  });
}

const declaration_regformat = [
  /\/\/.*/, //line comment
  /((reg|wire|logic|integer|bit|byte|shortint|int|longint|time|shortreal|real|double|realtime|assign)  *(signed)* *)/, //data_type
  /((<=.*)|(=.*);)|;/,  //assignment
  /(\[[^:]*:[^:]*\])+/, //vector
  /(\[[^:]*:[^:]*\])+/, //array
  /.*/, // variable (/wo assignment)
];
const dec_or_assign = /(((reg|wire|logic|integer|bit|byte|shortint|int|longint|time|shortreal|real|double|realtime|assign)  *(signed)* *))|((<=.*)|(=.*))/;

const moduleio_regformat = /module .*\(/;

const io_regformat = [
  /\/\/.*/, //line comment
  /(input|output) *(reg|wire|logic|integer|bit|byte|shortint|int|longint|time|shortreal|real|double|realtime)*( *(signed)*)*/, //data_type
  /(\[[^:]*:[^:]*\])+/, //vector
  /.*/, // variable (/wo assignment)
];


function test_new(data:string): string{
  if(check_type(data, moduleio_regformat)){
    return io_proc(data);
  }
  else{
    return declration_and_assignment_proc(data);
  }
}

function declration_and_assignment_proc(data: string): string{
  let v1 = data.split('\n');
  let ident = get_ident(v1, dec_or_assign);
  let v2 = decs_handle(v1); // split a statement into fields and do inner-field prealignment
  let v3 = common_format(v2, ident); // format the statements
  return v3;
}

function io_proc(data: string): string{
  let statement_obj : StatementString = {str : data};
  let mod = get_state_field(statement_obj, /module .*\(/);
  let modend = get_state_field(statement_obj, /\);/);
  let ss = statement_obj.str.replace(/,.*(\/\/.*)/g, '$1');
  let ios = ss.split('\n');
  let v2 = ios_handle(ios);
  let v3 = ios_format(v2);
  let v4 = common_format(v3, ' '.repeat(2));
  v4 = mod + '\n' + v4 + '\n' + modend;
  return v4;
}

const ios_handle = function (ios: string[]): CodeLine[]{
  ios = ios.map(io => io.replace(/,/g, '').trim());
  if(vscode.workspace.getConfiguration("systemverilog")['condenseBlankLines']){
    ios = cleanArray(ios);
  }
  else{
    while(ios[0] == '')
      ios.shift();

    while(ios[ios.length-1] == '')
      ios.pop();
  }

  let ios_r = ios.map(io_split);
  ios_r = dec_align_vec(ios_r, 1); // align vector
  return ios_r.map(io => {
    if(io instanceof FormattedLine){
      if(vscode.workspace.getConfiguration("systemverilog")['alignEndOfLine']){
        io.fields[2] = io.fields[2].replace(',', '');
        io.fields[3] = ','+io.fields[3];
      }
      else{
        if(io.fields[3][0] == ',')
          io.fields[3] = io.fields[3].slice(1);
        io.fields[2] = io.fields[2]+',';
      }
    }
    return io;    
  });
}

const io_split = function(io_i: string): CodeLine {
  if(io_i == '')
    return new UnformattedLine(io_i);
  else if(check_type(io_i, io_regformat[1])) {// split into list of io field
    let io = io_into_fields(io_i, io_regformat);
    // io_reg [comment, data_type, assignment, vector, array, variable] 
    return new FormattedLine([io[1], io[2], io[3], io[0]]);
  }
  else if(!check_type(io_i, io_regformat[0]))
    return new FormattedLine(['', '', io_i.trim(), '']);
  else // unchange and marked as don't touch
    return new UnformattedLine(io_i);
};

function io_into_fields(statement: string, fields: RegExp[]): string[]{
  let statement_obj : StatementString = {str : statement};
  let format_list: string[] = [];
  format_list.push(get_state_field_donttouch(statement_obj, fields[0])); //comment
  format_list.push(get_state_field(statement_obj, fields[1])); // assignment
  format_list.push(get_state_field(statement_obj, fields[2])); // dtype
  format_list.push(get_state_field(statement_obj, fields[3])); // vector
  format_list.push(get_state_field(statement_obj, fields[4])); // array
  format_list[1] = format_list[1].replace(/\binput\b/, 'input ').replace(/\binout\b/, 'inout ');
  return format_list;
}

const ios_format = function(decs: CodeLine[]): CodeLine[]{
  let idx = decs.length - 1;
  while(!(decs[idx] instanceof FormattedLine) && idx >= 0)
    idx--;
  if(idx >= 0)
    (decs[idx] as FormattedLine).fields[2] = (decs[idx] as FormattedLine).fields[2].replace(',', '')
  return decs;
}

const common_format = function(declarations_infield: CodeLine[], ident: string): string{
  let anchors = get_anchors(declarations_infield);
  let recontructs = declarations_infield.map(dec => dec.format(anchors, ident));
  return recontructs.join('\n');
}

const decs_handle = function (declarations: string[]): CodeLine[]{
  let decs_r = declarations.map(dec_split);
  
  // dec     [mask, dtype, vec, variable, array, assignment]
  decs_r = dec_align_vec(decs_r, 1); // align vector
  decs_r = dec_align_vec(decs_r, 3); // align array
  decs_r = dec_align_assignment(decs_r, 5); // align assignment

  return decs_r;
}

const dec_split = function(declaration: string): CodeLine {
  if(check_type(declaration, dec_or_assign)) {// split into list of declaration field
    let dec = split_into_fields(declaration, declaration_regformat);
    // dec_reg [flag, comment, data_type, assignment, vector, array, variable] 
    let dec_arrange = [dec[1], dec[3], dec[5], dec[4], dec[2], dec[0]];
    return new FormattedLine(dec_arrange);
  }
  else // unchange and marked as don't touch
    return new UnformattedLine(declaration);
};

function dec_align_assignment(declarations: CodeLine[], assign_idx: number): CodeLine[]{
  let rval_max = 0;
  for(let dec of declarations){
    if(dec instanceof FormattedLine){
      if(dec.fields[assign_idx].search(/(=)/) !== -1){ // is assignment
        dec.fields[assign_idx] = dec.fields[assign_idx].replace(/([\+\-\*]{1,2}|\/)/g,  ' $1 ');
        dec.fields[assign_idx] = dec.fields[assign_idx].replace(/(,)/g,  '$1 ');
        if(dec.fields[assign_idx].search(/<=/) !== -1){
          dec.fields[assign_idx] = dec.fields[assign_idx].slice(2, dec.fields[assign_idx].length-1).trim();
          rval_max = dec.fields[assign_idx].length > rval_max ? dec.fields[assign_idx].length : rval_max;
          dec.fields[assign_idx] = '<= '+ dec.fields[assign_idx];
        }
        else {
          dec.fields[assign_idx] = dec.fields[assign_idx].slice(1, dec.fields[assign_idx].length-1).trim();
          rval_max = dec.fields[assign_idx].length > rval_max ? dec.fields[assign_idx].length : rval_max;
          dec.fields[assign_idx] = '= '+ dec.fields[assign_idx];
        }
      }
      else {
        dec.fields[assign_idx] = '';
      }
    }
  }
  rval_max += 2;
  for(let dec of declarations){
    if(dec instanceof FormattedLine){
      if(dec.fields[assign_idx].search(/<=/) !== -1)
        dec.fields[assign_idx] = PadRight(dec.fields[assign_idx], rval_max+1) + ';';
      else
        dec.fields[assign_idx] = PadRight(dec.fields[assign_idx], rval_max) + ';';
    }
  }
  return declarations;
}

function dec_align_vec(declarations: CodeLine[], vec_field_idx: number): CodeLine[]{
  let idxs = declarations.map(dec => get_vec_idxs(dec, vec_field_idx));
  let rval_max = idxs.filter(a => a.length > 0)
    .reduce(reduce_max_array, []);
  let vec_strs = idxs.map(idx => gen_vec_string(idx, rval_max));

  vec_strs.forEach((vec_str,i) => {
    let dec = declarations[i];
    if(dec instanceof FormattedLine) 
      dec.fields[vec_field_idx] = vec_str;
  });
  
  return declarations;
}

function get_ident(declarations: string[], type: RegExp): string{
  let first = declarations.find(dec => check_type(dec, type));
  if(first)
    return first.match(/\s*/)[0]; // get ident from first statement
  else
    return '';
}

function check_type(statement:string, type_identifier:RegExp): boolean{
  return (statement.search(type_identifier) !== -1);
}
function split_into_fields(statement: string, fields: RegExp[]): string[] {
  let format_list = [];
  let statement_obj : StatementString = {str : statement};
  format_list.push(get_state_field_donttouch(statement_obj, fields[0])); //comment
  format_list.push(get_state_field(statement_obj, fields[1])); // assignment
  format_list.push(get_state_field(statement_obj, fields[2])); // dtype
  if(format_list[1]  == 'assign' || format_list[1] == ""){ //pure assignment
    format_list.push(""); //no vector
    format_list.push(""); //no array
  }
  else{
    format_list.push(get_state_field(statement_obj, fields[3])); // vector
    format_list.push(get_state_field(statement_obj, fields[4])); // array
  }
  format_list.push(get_state_field(statement_obj, fields[5]).replace(/(,)/g,  '$1 ')); // l_value or variable
  return format_list;
}
function get_anchors(statements_infield: CodeLine[]): number[]{
  return statements_infield.filter(s => s instanceof FormattedLine)
    .map(s => (s as FormattedLine).fields)
    .reduce(reduce_max_array, [])
    .map(a_cnt => a_cnt > 0 ? a_cnt + 1: a_cnt);
}
function get_state_field(s_obj: StatementString, regx: RegExp): string{
  let field = '';
  let field_t = s_obj.str.match(regx);
  if(field_t){
    field = field_t[0].trim().replace(/\s{2,}/g, ' ');
    s_obj.str = s_obj.str.replace(regx, '');
  }
  return field;
}
function get_state_field_donttouch(s_obj: StatementString, regx: RegExp): string{
  let field = '';
  let field_t = s_obj.str.match(regx);
  if(field_t){
    field = field_t[0];
    s_obj.str = s_obj.str.replace(regx, '');
  }
  return field;
}
function get_max(a, b){
  return a > b ? a : b;
}
function cleanArray<T>(actual: T[]): T[] {
  return actual.filter(act => act);
}
function PadLeft(str:string, width: number): string {
  return ' '.repeat(width - str.length) + str;
}
function PadRight(str:string, width: number): string {
  return str + ' '.repeat(width - str.length);
}
function reduce_max_array(acc: number[], val: string[]): number[]{
  let res = acc.slice(0);
  for (let i = 0; i < res.length && i < val.length; i++) {
    if(val[i].length > acc[i])
      res[i] = val[i].length;
  }
  return res.concat(val.slice(res.length).map(s => s.length));
}
function get_vec_idxs(dec: CodeLine, vec_field_idx: number): string[] {
  if(dec instanceof FormattedLine) {
    if(dec.fields[vec_field_idx].search(/\[/) !== -1){ // has vector
      let vec_ary: string[] = dec.fields[vec_field_idx].split(/[\[\]:]/).slice(0,-1);
      return cleanArray(vec_ary);
    }
    else {
      return [];
    }      
  }
  else{
    return [];
  }
}
function gen_vec_string(idxs: string[], widths: number[]){
  let restruc = '';
  return idxs
    .map((idx,i) => i%2 == 0 ? `[${PadLeft(idx, widths[i])}:` : `${PadLeft(idx, widths[i])}]`)
    .join('');
}

interface StatementString { str: string; }

class FormattedLine {
  fields: string[];
  constructor(fs: string[]) {
    this.fields = fs;
  }
  format(anchors: number[], ident): string {
    return this.fields
    .map((s,i) => `${PadRight(s, anchors[i])}`)
    .reduce((acc,str) => acc+str, ident);
  }
}
class UnformattedLine {
  line: string;
  constructor(text:string){
    this.line = text;
  }
  format(anchors: number[], ident): string {
    return this.line;
  }
}
type CodeLine = FormattedLine | UnformattedLine;
